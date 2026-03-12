// ABOUTME: CLI command to initialize a Google Doc for citation management.
// ABOUTME: Creates doc state with library binding and citation style.

import { Command } from "commander";
import chalk from "chalk";
import { initDocState } from "../lib/doc-state.js";
import type { CitationStyle } from "../types/index.js";
import { loadConfig } from "../lib/config.js";

export function registerInitCommand(program: Command): void {
  program
    .command("init")
    .description("Initialize a Google Doc for citation management")
    .requiredOption("--doc <docId>", "Google Doc ID")
    .option("--library <id>", "Library ID (e.g. group/12345)")
    .option("--style <style>", "Citation style", "vancouver")
    .action(async (opts) => {
      const config = await loadConfig();
      const libraryId =
        opts.library ||
        config.zotero?.defaultLibrary ||
        "local";

      try {
        const state = await initDocState(opts.doc, libraryId, opts.style as CitationStyle);
        console.log(chalk.green("✓ Document initialized for citation management\n"));
        console.log(`  Doc ID:   ${state.docId}`);
        console.log(`  Library:  ${state.libraryId}`);
        console.log(`  Style:    ${state.style}`);
        console.log(
          `\nUse ${chalk.cyan("cite insert")} to add citations and ${chalk.cyan("cite bib")} to generate bibliography.`,
        );
      } catch (err: any) {
        console.error(chalk.red(`Error: ${err.message}`));
        process.exit(1);
      }
    });
}
