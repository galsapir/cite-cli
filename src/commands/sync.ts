// ABOUTME: CLI command to sync references between local library and Zotero.
// ABOUTME: Fetches Zotero items and deduplicates by DOI.

import { Command } from "commander";
import chalk from "chalk";
import { loadConfig } from "../lib/config.js";
import { loadLibrary, saveLibrary, generateCiteKey } from "../lib/library.js";
import { fetchZoteroLibrary } from "../lib/zotero.js";
import type { LibraryEntry } from "../types/index.js";

export function registerSyncCommand(program: Command): void {
  program
    .command("sync")
    .description("Sync local library mirror with Zotero cloud")
    .option("--library <id>", "Library to sync (overrides default)")
    .action(async (opts) => {
      const config = await loadConfig();
      const libraryId =
        opts.library || config.zotero?.defaultLibrary;

      if (!libraryId) {
        console.error(
          chalk.red(
            "No library specified. Use --library or set zotero.defaultLibrary in config.",
          ),
        );
        process.exit(1);
      }

      if (!config.zotero?.apiKey) {
        console.error(
          chalk.red("Zotero not configured. Run 'cite auth zotero' first."),
        );
        process.exit(1);
      }

      console.log(`Syncing library "${libraryId}" with Zotero...`);

      try {
        // Fetch from Zotero
        const remoteEntries = await fetchZoteroLibrary(libraryId);
        console.log(`  Zotero: ${remoteEntries.length} entries`);

        // Load local
        const localEntries = await loadLibrary(libraryId);
        console.log(`  Local:  ${localEntries.length} entries`);

        // Merge: local entries keyed by DOI/zoteroKey for dedup
        const mergedMap = new Map<string, LibraryEntry>();

        // Add local entries first
        for (const entry of localEntries) {
          const dedup = entry.csl.DOI || entry.zoteroKey || entry.key;
          mergedMap.set(dedup, entry);
        }

        // Add remote entries, skip if already present
        let newFromRemote = 0;
        const existingKeys = localEntries.map((e) => e.key);
        for (const entry of remoteEntries) {
          const dedup = entry.csl.DOI || entry.zoteroKey || entry.key;
          if (!mergedMap.has(dedup)) {
            // Generate a unique key
            const key = generateCiteKey(entry.csl, existingKeys);
            existingKeys.push(key);
            entry.key = key;
            mergedMap.set(dedup, entry);
            newFromRemote++;
          }
        }

        const merged = [...mergedMap.values()];
        await saveLibrary(libraryId, merged);

        console.log(`\n${chalk.green("✓")} Sync complete:`);
        console.log(`  Total entries: ${merged.length}`);
        if (newFromRemote > 0) {
          console.log(`  New from Zotero: ${chalk.cyan(newFromRemote.toString())}`);
        } else {
          console.log(`  Already up to date.`);
        }
      } catch (err: any) {
        console.error(chalk.red(`Sync error: ${err.message}`));
        process.exit(1);
      }
    });
}
