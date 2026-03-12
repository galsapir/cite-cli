// ABOUTME: CLI command to search the local citation library.
// ABOUTME: Supports filtering by author, year, tag, and free-text query.

import { Command } from "commander";
import chalk from "chalk";
import { searchLibrary, loadLibrary } from "../lib/library.js";
import { loadConfig } from "../lib/config.js";
import { formatLibraryEntry } from "../lib/format.js";

export function registerSearchCommand(program: Command): void {
  program
    .command("search")
    .description("Search the local citation library")
    .argument("[query]", "Search query (matches title, key, author)")
    .option("--author <name>", "Filter by author name")
    .option("--year <year>", "Filter by publication year")
    .option("--tag <tag>", "Filter by tag")
    .option("--library <id>", "Library to search (overrides default)")
    .action(async (query: string | undefined, opts) => {
      const config = await loadConfig();
      const libraryId =
        opts.library ||
        config.zotero?.defaultLibrary ||
        "local";

      if (!query && !opts.author && !opts.year && !opts.tag) {
        // List all entries
        const entries = await loadLibrary(libraryId);
        if (entries.length === 0) {
          console.log(
            chalk.yellow(
              `No entries in library "${libraryId}". Use 'cite add' to add references.`,
            ),
          );
          return;
        }
        console.log(`${entries.length} entries in library "${libraryId}":\n`);
        for (const entry of entries) {
          console.log(`  ${formatLibraryEntry(entry)}`);
        }
        return;
      }

      const results = await searchLibrary(libraryId, {
        query,
        author: opts.author,
        year: opts.year,
        tag: opts.tag,
      });

      if (results.length === 0) {
        console.log(chalk.yellow("No matching entries found."));
        return;
      }

      console.log(`${results.length} result${results.length !== 1 ? "s" : ""}:\n`);
      for (const entry of results) {
        console.log(`  ${formatLibraryEntry(entry)}`);
      }
    });
}
