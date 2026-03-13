// ABOUTME: CLI command to scan a Google Doc for pasted academic URLs and convert them to citations.
// ABOUTME: Finds DOI/PubMed/arXiv hyperlinks, resolves them, replaces with formatted markers, and updates bib.

import { Command } from "commander";
import { confirm } from "@inquirer/prompts";
import chalk from "chalk";
import { loadDocState, saveDocState } from "../lib/doc-state.js";
import { loadLibrary, addToLibrary } from "../lib/library.js";
import { fetchDoc, findAcademicHyperlinks, batchUpdate } from "../lib/google-docs.js";
import type { AcademicHyperlink } from "../lib/google-docs.js";
import { resolve } from "../lib/resolver.js";
import { formatInlineCitation } from "../lib/formatter.js";
import { formatReference } from "../lib/format.js";
import { addToZotero, getCollectionName, resolveCollectionKey } from "../lib/zotero.js";
import { logOperation, checkRevisionId, validateBatchRequests } from "../lib/safety.js";
import { resolveDocId } from "../lib/config.js";
import type { docs_v1 } from "googleapis";
import type { CitationEntry, LibraryEntry, CslJson } from "../types/index.js";
import { CITE_LINK_PREFIX, CITE_RANGE_PREFIX } from "../types/index.js";

interface ResolvedHyperlink {
  hyperlink: AcademicHyperlink;
  key: string;
  csl: CslJson;
  isNew: boolean; // true if newly added to library
  index: number;  // citation index in the doc
}

export function registerScanCommand(program: Command): void {
  program
    .command("scan")
    .description("Scan document for pasted reference URLs and convert to citations")
    .option("--doc <docId>", "Google Doc ID")
    .option("--collection <name>", "Zotero collection to add new references to")
    .option("--dry-run", "Preview only, do not write")
    .option("-y, --yes", "Skip confirmation prompt")
    .action(async (opts) => {
      opts.doc = await resolveDocId(opts.doc);
      const docState = await loadDocState(opts.doc);
      if (!docState) {
        console.error(
          chalk.red(
            `Doc ${opts.doc} not initialized. Run 'cite init --doc ${opts.doc}' first.`,
          ),
        );
        process.exit(1);
      }

      // Fetch the document
      console.log("Fetching document...");
      const doc = await fetchDoc(opts.doc);
      console.log(`  Document: "${doc.title}" (rev: ${doc.revisionId.slice(0, 8)}...)`);

      if (docState.revisionId && !checkRevisionId(docState.revisionId, doc.revisionId)) {
        console.log(
          chalk.yellow(
            "Warning: Document has been modified since last cite operation. " +
            "Citation indices may be stale.",
          ),
        );
      }

      // Find academic hyperlinks in the document
      const hyperlinks = findAcademicHyperlinks(doc.body);

      if (hyperlinks.length === 0) {
        console.log(chalk.dim("No unprocessed reference URLs found in document."));
        return;
      }

      console.log(`\nFound ${hyperlinks.length} reference URL(s):\n`);

      // Resolve each hyperlink
      const library = await loadLibrary(docState.libraryId);
      const existingKeys = library.map((e) => e.key);
      const resolved: ResolvedHyperlink[] = [];
      const newEntries: LibraryEntry[] = [];

      // Build DOI→key index for O(1) dedup lookups
      const doiToKey = new Map<string, string>();
      for (const e of library) {
        if (e.csl.DOI) doiToKey.set(e.csl.DOI, e.key);
      }

      // Track the next available citation index (avoids recalculating max each iteration)
      let nextIndex = docState.citations.length > 0
        ? Math.max(...docState.citations.map((c) => c.index)) + 1
        : 1;

      // Map from key → already-assigned index in this batch
      const batchKeyToIndex = new Map<string, number>();

      for (const hl of hyperlinks) {
        try {
          const result = await resolve(hl.url, [...existingKeys, ...newEntries.map((e) => e.key)]);

          // Check if this reference already exists (by DOI)
          const existingKey = result.csl.DOI ? doiToKey.get(result.csl.DOI) : undefined;

          let key: string;
          let isNew: boolean;

          if (existingKey) {
            key = existingKey;
            isNew = false;
          } else {
            key = result.suggestedKey;
            isNew = true;
            newEntries.push({
              key,
              csl: result.csl,
              addedAt: new Date().toISOString(),
            });
            if (result.csl.DOI) doiToKey.set(result.csl.DOI, key);
          }

          // Determine citation index
          const existingCitation = docState.citations.find((c) => c.key === key);
          let index: number;
          if (existingCitation) {
            index = existingCitation.index;
          } else if (batchKeyToIndex.has(key)) {
            index = batchKeyToIndex.get(key)!;
          } else {
            index = nextIndex++;
            batchKeyToIndex.set(key, index);
          }

          resolved.push({ hyperlink: hl, key, csl: result.csl, isNew, index });

          const status = isNew ? chalk.green("NEW") : chalk.dim("exists");
          console.log(`  ${status} [${index}] ${formatReference(result.csl, key)}`);
          console.log(chalk.dim(`        "${hl.text}" → ${hl.url}`));
        } catch (err: any) {
          console.log(`  ${chalk.red("✗")} Failed to resolve: ${hl.url}`);
          console.log(chalk.dim(`    ${err.message}`));
        }
      }

      if (resolved.length === 0) {
        console.log(chalk.yellow("\nNo references could be resolved."));
        return;
      }

      console.log(`\n${resolved.length} reference(s) resolved (${newEntries.length} new).`);

      if (opts.dryRun) {
        console.log(chalk.dim("\n(dry-run mode — no changes made)"));
        return;
      }

      if (!opts.yes) {
        const ok = await confirm({
          message: "Process these references?",
          default: true,
        });
        if (!ok) {
          console.log("Cancelled.");
          return;
        }
      }

      // Resolve collection for new entries
      let collectionKey: string | undefined;
      if (newEntries.length > 0) {
        const collectionName = await getCollectionName(docState.libraryId, opts.collection);
        if (collectionName) {
          collectionKey = await resolveCollectionKey(docState.libraryId, collectionName);
          console.log(chalk.dim(`  → Collection: ${collectionName}`));
        }
      }

      // Add new entries to library and Zotero
      for (const entry of newEntries) {
        const zoteroKey = await addToZotero(docState.libraryId, entry.csl, collectionKey);
        if (zoteroKey) entry.zoteroKey = zoteroKey;
        await addToLibrary(docState.libraryId, entry);
      }

      if (newEntries.length > 0) {
        console.log(chalk.dim(`  → Added ${newEntries.length} reference(s) to library`));
      }

      // Build batch update requests: replace each hyperlink with a citation marker.
      // Sort by reverse position to prevent index shifting.
      const sortedResolved = [...resolved].sort(
        (a, b) => b.hyperlink.startIndex - a.hyperlink.startIndex,
      );

      const style = docState.style;
      const allLibraryEntries = [...library, ...newEntries];
      const allRequests: docs_v1.Schema$Request[] = [];
      const newCitations: CitationEntry[] = [];

      // Track which request indices correspond to createNamedRange
      const namedRangeRequestInfo: Array<{ requestIndex: number; key: string }> = [];

      for (const r of sortedResolved) {
        const cslEntries = [allLibraryEntries.find((e) => e.key === r.key)?.csl].filter(Boolean) as CslJson[];
        const marker = formatInlineCitation([r.index], style, cslEntries);

        // Delete the old hyperlinked text
        allRequests.push({
          deleteContentRange: {
            range: {
              startIndex: r.hyperlink.startIndex,
              endIndex: r.hyperlink.endIndex,
            },
          },
        });

        // Insert the citation marker at the same position
        allRequests.push({
          insertText: {
            location: { index: r.hyperlink.startIndex },
            text: marker,
          },
        });

        // Add citation hyperlink
        allRequests.push({
          updateTextStyle: {
            range: {
              startIndex: r.hyperlink.startIndex,
              endIndex: r.hyperlink.startIndex + marker.length,
            },
            textStyle: {
              link: { url: `${CITE_LINK_PREFIX}${r.key}` },
            },
            fields: "link",
          },
        });

        // Create named range
        const namedRangeReqIndex = allRequests.length;
        allRequests.push({
          createNamedRange: {
            name: `${CITE_RANGE_PREFIX}${r.key}`,
            range: {
              startIndex: r.hyperlink.startIndex,
              endIndex: r.hyperlink.startIndex + marker.length,
            },
          },
        });
        namedRangeRequestInfo.push({ requestIndex: namedRangeReqIndex, key: r.key });

        // Track new citations for doc state
        if (!docState.citations.find((c) => c.key === r.key) &&
            !newCitations.find((c) => c.key === r.key)) {
          newCitations.push({
            index: r.index,
            key: r.key,
            location: `scan:${r.hyperlink.url}`,
          });
        }
      }

      // Pre-write safety validation
      validateBatchRequests(allRequests, doc.body);

      // Execute batch update
      const replies = await batchUpdate(opts.doc, allRequests);

      // Extract namedRangeIds from replies
      for (const info of namedRangeRequestInfo) {
        const reply = replies[info.requestIndex];
        const rangeId = reply?.createNamedRange?.namedRangeId;
        if (rangeId) {
          // Find the citation entry (existing or new)
          const existing = docState.citations.find((c) => c.key === info.key);
          if (existing) {
            if (!existing.namedRangeIds) existing.namedRangeIds = [];
            existing.namedRangeIds.push(rangeId);
          } else {
            const nc = newCitations.find((c) => c.key === info.key);
            if (nc) {
              if (!nc.namedRangeIds) nc.namedRangeIds = [];
              nc.namedRangeIds.push(rangeId);
            }
          }
        }
      }

      // Update doc state
      docState.citations.push(...newCitations);
      docState.lastSync = new Date().toISOString();
      docState.revisionId = doc.revisionId;
      await saveDocState(docState);

      for (const nc of newCitations) {
        await logOperation(
          opts.doc,
          `SCAN_INSERT [${nc.index}] (key: ${nc.key}, source: ${nc.location})`,
        );
      }

      console.log(
        chalk.green(
          `\n✓ Processed ${resolved.length} reference(s): ` +
          `${newCitations.length} new citation(s), ` +
          `${resolved.length - newCitations.length} existing`,
        ),
      );

      // Auto-update bibliography if it exists
      if (docState.bibNamedRange) {
        console.log(chalk.dim("  → Run 'cite bib' to update the bibliography."));
      }
    });
}
