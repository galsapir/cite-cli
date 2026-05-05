// ABOUTME: CLI command to insert inline citations into a Google Doc.
// ABOUTME: Supports text search and paragraph-based insertion with auto-numbering.

import { Command } from "commander";
import { confirm } from "@inquirer/prompts";
import chalk from "chalk";
import { loadDocState, saveDocState } from "../lib/doc-state.js";
import { loadLibrary, findInLibrary } from "../lib/library.js";
import { fetchDoc, findTextLocation, findParagraph } from "../lib/google-docs.js";
import { batchUpdate } from "../lib/google-docs.js";
import { formatInlineCitation } from "../lib/formatter.js";
import { sortRequestsReverseIndex, formatInsertPreview, logOperation, checkRevisionId, validateBatchRequests } from "../lib/safety.js";
import { loadConfig } from "../lib/config.js";
import { resolveSource, requireGoogleDocsSource } from "../lib/resolve-source.js";
import type { docs_v1 } from "googleapis";
import type { CitationEntry, CslJson } from "../types/index.js";
import { CITE_LINK_PREFIX, CITE_RANGE_PREFIX } from "../types/index.js";

export function registerInsertCommand(program: Command): void {
  program
    .command("insert")
    .description("Insert an inline citation into a Google Doc")
    .option("--doc <docId>", "Google Doc ID")
    .option("--markdown <path>", "Markdown file (not yet supported — planned in a follow-up PR)")
    .option("--key <key>", "Citation key from library")
    .option("--keys <keys>", "Comma-separated citation keys")
    .option("--after <text>", "Insert after this search string (first occurrence)")
    .option("--occurrence <n>", "Which occurrence of the search string", "1")
    .option("--paragraph <n>", "Insert at paragraph number (1-indexed)")
    .option("--position <pos>", "Position within paragraph: start or end", "end")
    .option("--dry-run", "Preview only, do not write")
    .option("-y, --yes", "Skip confirmation prompt")
    .action(async (opts) => {
      const resolved = await resolveSource({ doc: opts.doc, markdown: opts.markdown });
      requireGoogleDocsSource(resolved, "insert");
      opts.doc = resolved.stateKey;
      const docState = await loadDocState(opts.doc);
      if (!docState) {
        console.error(
          chalk.red(
            `Doc ${opts.doc} not initialized. Run 'cite init --doc ${opts.doc}' first.`,
          ),
        );
        process.exit(1);
      }

      // Determine which keys to insert
      const keys: string[] = [];
      if (opts.keys) {
        keys.push(...opts.keys.split(",").map((k: string) => k.trim()));
      } else if (opts.key) {
        keys.push(opts.key);
      } else {
        console.error(chalk.red("Provide --key or --keys."));
        process.exit(1);
      }

      // Load library and validate keys exist
      const library = await loadLibrary(docState.libraryId);
      const cslEntries: CslJson[] = [];
      for (const key of keys) {
        const entry = library.find((e) => e.key === key);
        if (!entry) {
          console.error(
            chalk.red(`Key "${key}" not found in library "${docState.libraryId}".`),
          );
          process.exit(1);
        }
        cslEntries.push(entry.csl);
      }

      // Fetch the document
      console.log("Fetching document...");
      const doc = await fetchDoc(opts.doc);
      console.log(`  Document: "${doc.title}" (rev: ${doc.revisionId.slice(0, 8)}...)`);

      // Check for concurrent edits since last operation
      if (docState.revisionId && !checkRevisionId(docState.revisionId, doc.revisionId)) {
        console.log(
          chalk.yellow(
            "Warning: Document has been modified since last cite operation. " +
            "Citation indices may be stale.",
          ),
        );
      }

      // Determine insertion point
      let insertIndex: number;
      let contextText = "";
      let paragraphIdx = 0;

      if (opts.after) {
        const loc = findTextLocation(
          doc.body,
          opts.after,
          parseInt(opts.occurrence),
        );
        if (!loc) {
          console.error(
            chalk.red(`Text "${opts.after}" not found in document.`),
          );
          process.exit(1);
        }
        insertIndex = loc.endIndex; // Insert right after the match
        contextText = loc.context;
        paragraphIdx = loc.paragraphIndex;
      } else if (opts.paragraph) {
        const para = findParagraph(doc.body, parseInt(opts.paragraph));
        if (!para) {
          console.error(
            chalk.red(`Paragraph ${opts.paragraph} not found.`),
          );
          process.exit(1);
        }
        insertIndex =
          opts.position === "start" ? para.startIndex : para.endIndex - 1;
        paragraphIdx = parseInt(opts.paragraph) - 1;
        contextText = `paragraph ${opts.paragraph}`;
      } else {
        console.error(
          chalk.red("Provide --after or --paragraph to specify insertion point."),
        );
        process.exit(1);
      }

      // Assign citation numbers
      const indices: number[] = [];
      const newCitations: CitationEntry[] = [];

      for (const key of keys) {
        const existing = docState.citations.find((c) => c.key === key);
        if (existing) {
          indices.push(existing.index);
        } else {
          const nextIndex =
            docState.citations.length > 0
              ? Math.max(...docState.citations.map((c) => c.index)) + 1
              : 1;
          const idx = nextIndex + newCitations.length;
          indices.push(idx);
          newCitations.push({
            index: idx,
            key,
            location: opts.after
              ? `after:${opts.after}`
              : `paragraph:${opts.paragraph}`,
          });
        }
      }

      // Format the citation marker
      const style = docState.style;
      const marker =
        " " + formatInlineCitation(indices, style, cslEntries);

      // Preview
      console.log("");
      console.log(
        formatInsertPreview(marker.trim(), contextText, paragraphIdx, insertIndex),
      );
      console.log("");

      if (opts.dryRun) {
        console.log(chalk.dim("(dry-run mode — no changes made)"));
        return;
      }

      if (!opts.yes) {
        const ok = await confirm({
          message: "Insert this citation?",
          default: true,
        });
        if (!ok) {
          console.log("Cancelled.");
          return;
        }
      }

      // Build the batch update requests.
      // Requests execute sequentially — insert text first, then style
      // and name the range using post-insert indices.
      const citationText = marker.trimStart(); // e.g. "[1]"
      const citationStart = insertIndex + (marker.length - citationText.length);
      const citationEnd = insertIndex + marker.length;

      // Encode all cited keys into the hyperlink for durability
      const linkKeys = keys.join(",");
      const linkUrl = `${CITE_LINK_PREFIX}${linkKeys}`;

      const requests: docs_v1.Schema$Request[] = [
        // 1. Insert the citation text (with leading space)
        {
          insertText: {
            location: { index: insertIndex },
            text: marker,
          },
        },
        // 2. Add hyperlink to the citation text (not the leading space)
        {
          updateTextStyle: {
            range: {
              startIndex: citationStart,
              endIndex: citationEnd,
            },
            textStyle: {
              link: { url: linkUrl },
            },
            fields: "link",
          },
        },
      ];

      // 3. Create a named range per cited key for programmatic lookup
      const namedRangeRequests: docs_v1.Schema$Request[] = [];
      for (const key of keys) {
        namedRangeRequests.push({
          createNamedRange: {
            name: `${CITE_RANGE_PREFIX}${key}`,
            range: {
              startIndex: citationStart,
              endIndex: citationEnd,
            },
          },
        });
      }
      requests.push(...namedRangeRequests);

      // Pre-write safety validation (only checks insert/delete requests)
      validateBatchRequests(requests, doc.body);

      // Execute
      const replies = await batchUpdate(opts.doc, requests);

      // Extract namedRangeIds from replies.
      // Replies array mirrors requests array: [insertReply, styleReply, ...namedRangeReplies]
      const namedRangeReplies = replies.slice(2); // skip insert + style replies

      // Update doc state
      for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        const rangeId = namedRangeReplies[i]?.createNamedRange?.namedRangeId;

        const existingEntry = docState.citations.find((c) => c.key === key);
        if (existingEntry) {
          // Re-citing an existing key — append the new named range ID
          if (!existingEntry.namedRangeIds) existingEntry.namedRangeIds = [];
          if (rangeId) existingEntry.namedRangeIds.push(rangeId);
        } else {
          // New citation — find it in newCitations and set the range ID
          const nc = newCitations.find((c) => c.key === key);
          if (nc && rangeId) {
            nc.namedRangeIds = [rangeId];
          }
        }
      }

      docState.citations.push(...newCitations);
      docState.lastSync = new Date().toISOString();
      docState.revisionId = doc.revisionId;
      await saveDocState(docState);

      // Log the operation
      for (const nc of newCitations) {
        await logOperation(
          opts.doc,
          `INSERT [${nc.index}] at index ${insertIndex} (key: ${nc.key})`,
        );
      }

      console.log(
        chalk.green(
          `✓ Inserted ${marker.trim()} at index ${insertIndex}`,
        ),
      );

      // Auto-sync bibliography if configured
      const config = await loadConfig();
      if (config.defaults?.autoSyncBib) {
        console.log(chalk.dim("  (auto-sync bibliography is enabled — run 'cite bib' to update)"));
      }
    });
}
