// ABOUTME: CLI command to scan a document for pasted academic URLs and convert them to citations.
// ABOUTME: Backend-agnostic: works against any DocumentSource (Google Docs, markdown, …).

import { Command } from "commander";
import { confirm } from "@inquirer/prompts";
import chalk from "chalk";
import { loadDocState, saveDocState } from "../lib/doc-state.js";
import { loadLibrary, addToLibrary } from "../lib/library.js";
import { GoogleDocsSource } from "../lib/google-docs.js";
import { resolve, canonicalIds } from "../lib/resolver.js";
import { formatReference } from "../lib/format.js";
import { addToZotero, getCollectionName, resolveCollectionKey } from "../lib/zotero.js";
import { logOperation, checkRevisionId } from "../lib/safety.js";
import { resolveDocId } from "../lib/config.js";
import type { CitationEntry, LibraryEntry, CslJson } from "../types/index.js";
import type { DocumentSource, PendingReference, ScanWriteItem } from "../lib/document-source.js";

interface ResolvedRef {
  ref: PendingReference;
  key: string;
  csl: CslJson;
  isNew: boolean;
  index: number;
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

      const source: DocumentSource = new GoogleDocsSource(opts.doc);
      console.log(`Fetching ${source.describe()}...`);
      const loaded = await source.loadAcademicReferences();
      console.log(`  rev: ${loaded.revisionToken.slice(0, 8)}...`);

      if (docState.revisionId && !checkRevisionId(docState.revisionId, loaded.revisionToken)) {
        console.log(
          chalk.yellow(
            "Warning: Document has been modified since last cite operation. " +
            "Citation indices may be stale.",
          ),
        );
      }

      if (loaded.refs.length === 0) {
        console.log(chalk.dim("No unprocessed reference URLs found in document."));
        return;
      }

      console.log(`\nFound ${loaded.refs.length} reference URL(s):\n`);

      const library = await loadLibrary(docState.libraryId);
      const existingKeys = library.map((e) => e.key);
      const resolved: ResolvedRef[] = [];
      const newEntries: LibraryEntry[] = [];

      // Build identifier→key index for O(1) dedup lookups across DOI / PMID / arXiv / canonical URL.
      const idToKey = new Map<string, string>();
      const indexEntry = (csl: CslJson, key: string) => {
        for (const id of canonicalIds(csl)) idToKey.set(id, key);
      };
      for (const e of library) indexEntry(e.csl, e.key);

      let nextIndex = docState.citations.length > 0
        ? Math.max(...docState.citations.map((c) => c.index)) + 1
        : 1;

      const batchKeyToIndex = new Map<string, number>();

      for (const ref of loaded.refs) {
        try {
          const result = await resolve(ref.url, [...existingKeys, ...newEntries.map((e) => e.key)]);

          let existingKey: string | undefined;
          for (const id of canonicalIds(result.csl)) {
            const hit = idToKey.get(id);
            if (hit) { existingKey = hit; break; }
          }

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
            indexEntry(result.csl, key);
          }

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

          resolved.push({ ref, key, csl: result.csl, isNew, index });

          const status = isNew ? chalk.green("NEW") : chalk.dim("exists");
          console.log(`  ${status} [${index}] ${formatReference(result.csl, key)}`);
          console.log(chalk.dim(`        "${ref.text}" → ${ref.url}`));
        } catch (err: any) {
          console.log(`  ${chalk.red("✗")} Failed to resolve: ${ref.url}`);
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

      // Add new entries to library and (if applicable) Zotero
      let collectionKey: string | undefined;
      if (newEntries.length > 0) {
        const collectionName = await getCollectionName(docState.libraryId, opts.collection);
        if (collectionName) {
          collectionKey = await resolveCollectionKey(docState.libraryId, collectionName);
          console.log(chalk.dim(`  → Collection: ${collectionName}`));
        }
      }

      for (const entry of newEntries) {
        const zoteroKey = await addToZotero(docState.libraryId, entry.csl, collectionKey);
        if (zoteroKey) entry.zoteroKey = zoteroKey;
        await addToLibrary(docState.libraryId, entry);
      }

      if (newEntries.length > 0) {
        console.log(chalk.dim(`  → Added ${newEntries.length} reference(s) to library`));
      }

      const allLibraryEntries = [...library, ...newEntries];
      const writeItems: ScanWriteItem[] = resolved.map((r) => ({
        ref: r.ref,
        key: r.key,
        index: r.index,
      }));

      const outcome = await source.writeScanResults(writeItems, docState.style, allLibraryEntries);

      // Update doc state — fold occurrence handles into existing or new citations.
      const newCitations: CitationEntry[] = [];
      for (const r of resolved) {
        const handles = outcome.occurrenceHandles[r.key] ?? [];
        const existing = docState.citations.find((c) => c.key === r.key);
        if (existing) {
          if (handles.length > 0) {
            if (!existing.namedRangeIds) existing.namedRangeIds = [];
            existing.namedRangeIds.push(...handles);
          }
        } else if (!newCitations.find((c) => c.key === r.key)) {
          newCitations.push({
            index: r.index,
            key: r.key,
            location: `scan:${r.ref.url}`,
            namedRangeIds: handles.length > 0 ? [...handles] : undefined,
          });
        }
      }

      docState.citations.push(...newCitations);
      docState.lastSync = new Date().toISOString();
      docState.revisionId = outcome.newRevisionToken;
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

      if (docState.bibNamedRange) {
        console.log(chalk.dim("  → Run 'cite bib' to update the bibliography."));
      }
    });
}
