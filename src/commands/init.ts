// ABOUTME: CLI command to initialize a document for citation management.
// ABOUTME: Creates per-doc state for either a Google Doc (--doc) or a markdown file (--markdown).

import { Command } from "commander";
import chalk from "chalk";
import { initDocStateForGoogleDoc, initDocStateForMarkdown } from "../lib/doc-state.js";
import type { CitationStyle } from "../types/index.js";
import { loadConfig, resolveDocId } from "../lib/config.js";

export function registerInitCommand(program: Command): void {
  program
    .command("init")
    .description("Initialize a document (Google Doc or markdown file) for citation management")
    .option("--doc <docId>", "Google Doc ID")
    .option("--markdown <path>", "Markdown file path")
    .option("--library <id>", "Library ID (e.g. group/12345)")
    .option("--style <style>", "Citation style", "vancouver")
    .action(async (opts) => {
      if (opts.doc && opts.markdown) {
        console.error(chalk.red("Pass either --doc or --markdown, not both."));
        process.exit(1);
      }

      const config = await loadConfig();
      const libraryId =
        opts.library ||
        config.zotero?.defaultLibrary ||
        "local";

      try {
        if (opts.markdown) {
          const state = await initDocStateForMarkdown(
            opts.markdown,
            libraryId,
            opts.style as CitationStyle,
          );
          console.log(chalk.green("✓ Markdown file initialized for citation management\n"));
          console.log(`  Path:     ${(state.source as { type: "markdown"; filePath: string }).filePath}`);
          console.log(`  StateId:  ${state.docId}`);
          console.log(`  Library:  ${state.libraryId}`);
          console.log(`  Style:    ${state.style}`);
          console.log(
            `\nUse ${chalk.cyan("cite scan --markdown <path>")} to convert pasted reference URLs and ${chalk.cyan("cite bib --markdown <path>")} to generate the bibliography.`,
          );
          return;
        }

        const docId = await resolveDocId(opts.doc);
        const state = await initDocStateForGoogleDoc(
          docId,
          libraryId,
          opts.style as CitationStyle,
        );
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
