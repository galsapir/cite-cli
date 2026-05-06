// ABOUTME: CLI command to insert inline citations into a document source.
// ABOUTME: Google Docs uses numbered markers; markdown writes pandoc citation markers.

import { readFile } from "node:fs/promises";
import { Command } from "commander";
import { confirm } from "@inquirer/prompts";
import chalk from "chalk";
import { loadDocState, saveDocState } from "../lib/doc-state.js";
import { loadLibrary } from "../lib/library.js";
import { fetchDoc, findTextLocation, findParagraph } from "../lib/google-docs.js";
import { batchUpdate } from "../lib/google-docs.js";
import { formatInlineCitation } from "../lib/formatter.js";
import { formatInsertPreview, logOperation, checkRevisionId, validateBatchRequests } from "../lib/safety.js";
import { loadConfig } from "../lib/config.js";
import { resolveSource, initHintForSource } from "../lib/resolve-source.js";
import { firstAppearanceKeyOrder, rebuildMarkdownCitations } from "../lib/markdown-citation-state.js";
import { MarkdownAnchorNotFoundError } from "../lib/markdown-source.js";
import type { docs_v1 } from "googleapis";
import type { CitationEntry, CslJson, DocState, LibraryEntry } from "../types/index.js";
import type { MarkdownDocumentSource, MarkdownInsertAnchor } from "../lib/markdown-source.js";
import { CITE_LINK_PREFIX, CITE_RANGE_PREFIX } from "../types/index.js";

interface InsertOptions {
  doc?: string;
  markdown?: string;
  key?: string;
  keys?: string;
  after?: string;
  occurrence: string;
  paragraph?: string;
  position: string;
  dryRun?: boolean;
  yes?: boolean;
}

export function registerInsertCommand(program: Command): void {
  program
    .command("insert")
    .description("Insert an inline citation into a document")
    .option("--doc <docId>", "Google Doc ID")
    .option("--markdown <path>", "Markdown file to operate on (instead of a Google Doc)")
    .option("--key <key>", "Citation key from library")
    .option("--keys <keys>", "Comma-separated citation keys")
    .option("--after <text>", "Insert after this search string (first occurrence)")
    .option("--occurrence <n>", "Which occurrence of the search string", "1")
    .option("--paragraph <n>", "Insert at paragraph number (1-indexed)")
    .option("--position <pos>", "Position within paragraph: start or end", "end")
    .option("--dry-run", "Preview only, do not write")
    .option("-y, --yes", "Skip confirmation prompt")
    .action(async (opts: InsertOptions) => {
      validateInsertOptions(opts);
      const resolved = await resolveSource({ doc: opts.doc, markdown: opts.markdown });
      const { source, stateKey } = resolved;
      const docState = await loadDocState(stateKey);
      if (!docState) {
        console.error(chalk.red(`Document not initialized. Run '${initHintForSource(resolved)}' first.`));
        process.exit(1);
      }

      const keys = parseInsertKeys(opts);
      const library = await loadLibrary(docState.libraryId);
      const cslEntries = validateLibraryKeys(keys, library, docState.libraryId);

      if (source.kind === "markdown") {
        await insertIntoMarkdown(source as MarkdownDocumentSource, stateKey, docState, opts, keys);
        return;
      }

      // Fetch the document
      console.log("Fetching document...");
      const doc = await fetchDoc(stateKey);
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
      const replies = await batchUpdate(stateKey, requests);

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
          stateKey,
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

async function insertIntoMarkdown(
  source: MarkdownDocumentSource,
  stateKey: string,
  docState: DocState,
  opts: InsertOptions,
  keys: string[],
): Promise<void> {
  const anchor = markdownAnchorFromOptions(opts);
  const location = markdownLocationFromOptions(opts);
  const marker = `[@${keys.join("; @")}]`;
  let offset: number;

  try {
    offset = await source.locateInsertionPoint(anchor);
  } catch (err) {
    if (err instanceof MarkdownAnchorNotFoundError) {
      console.error(chalk.red(err.message));
      process.exit(1);
    }
    throw err;
  }

  const text = await readFile(source.filePath, "utf-8");
  console.log("");
  console.log(formatMarkdownInsertPreview(text, offset, marker));
  console.log("");

  if (opts.dryRun) {
    console.log(chalk.dim("(dry-run mode — no changes made)"));
    return;
  }

  if (!opts.yes) {
    const ok = await confirm({
      message: "Insert this citation into markdown?",
      default: true,
    });
    if (!ok) {
      console.log("Cancelled.");
      return;
    }
  }

  // Markdown writes the marker verbatim at the resolved offset; anchor text controls spacing.
  const result = await source.writeInsertion(offset, marker);
  const occurrences = await source.scanCitationOccurrences();
  const keyOrder = firstAppearanceKeyOrder(occurrences);

  docState.citations = rebuildMarkdownCitations(keyOrder, docState.citations, location);
  docState.lastSync = new Date().toISOString();
  docState.revisionId = result.newRevisionToken;
  await saveDocState(docState);

  for (const key of keys) {
    const citation = docState.citations.find((entry) => entry.key === key);
    await logOperation(
      stateKey,
      `INSERT_MARKDOWN [${citation?.index ?? "?"}] at offset ${offset} (key: ${key})`,
    );
  }

  console.log(chalk.green(`✓ Inserted ${marker} at offset ${offset}`));
}

function validateInsertOptions(opts: InsertOptions): void {
  if (opts.key && opts.keys) {
    console.error(chalk.red("Provide --key or --keys, not both."));
    process.exit(1);
  }
  if (!opts.key && !opts.keys) {
    console.error(chalk.red("Provide --key or --keys."));
    process.exit(1);
  }
  if (Boolean(opts.after) === Boolean(opts.paragraph)) {
    console.error(chalk.red("Provide exactly one of --after or --paragraph."));
    process.exit(1);
  }
  if (opts.position !== "start" && opts.position !== "end") {
    console.error(chalk.red("--position must be 'start' or 'end'."));
    process.exit(1);
  }
}

function parseInsertKeys(opts: InsertOptions): string[] {
  const keys = opts.keys
    ? opts.keys.split(",").map((key) => key.trim()).filter(Boolean)
    : [opts.key?.trim() ?? ""].filter(Boolean);
  if (keys.length === 0) {
    console.error(chalk.red("Provide --key or --keys."));
    process.exit(1);
  }
  return keys;
}

function validateLibraryKeys(keys: string[], library: LibraryEntry[], libraryId: string): CslJson[] {
  const missing = keys.filter((key) => !library.some((entry) => entry.key === key));
  if (missing.length > 0) {
    console.error(chalk.red(`Key(s) not found in library "${libraryId}": ${missing.join(", ")}.`));
    process.exit(1);
  }
  return keys.map((key) => library.find((entry) => entry.key === key)!.csl);
}

function markdownAnchorFromOptions(opts: InsertOptions): MarkdownInsertAnchor {
  if (opts.after) {
    return {
      type: "after",
      value: opts.after,
      occurrence: parseInt(opts.occurrence, 10),
    };
  }
  return {
    type: "paragraph",
    value: parseInt(opts.paragraph ?? "", 10),
    position: opts.position as "start" | "end",
  };
}

function markdownLocationFromOptions(opts: InsertOptions): string {
  if (opts.after) return `insert:--after=${opts.after}`;
  return `insert:--paragraph=${opts.paragraph}:${opts.position}`;
}

function formatMarkdownInsertPreview(text: string, offset: number, marker: string): string {
  const start = Math.max(0, offset - 40);
  const end = Math.min(text.length, offset + 40);
  const before = text.slice(start, offset).replace(/\n/g, "\\n");
  const after = text.slice(offset, end).replace(/\n/g, "\\n");
  return [
    chalk.bold("Markdown insert preview:"),
    `  ${before}${chalk.green(marker)}${after}`,
    `  offset: ${offset}`,
  ].join("\n");
}
