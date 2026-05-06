// ABOUTME: CLI command to initialize a document for citation management.
// ABOUTME: Creates per-doc state for Google Docs, markdown files, or markdown manifests.

import { Command } from "commander";
import chalk from "chalk";
import { access, writeFile } from "node:fs/promises";
import { resolve as resolvePath } from "node:path";
import { initDocStateForGoogleDoc, initDocStateForManifest, initDocStateForMarkdown } from "../lib/doc-state.js";
import type { CitationStyle } from "../types/index.js";
import { loadConfig, resolveDocId } from "../lib/config.js";
import { loadManifest } from "../lib/manifest.js";

export async function ensureManifestFile(manifestPath: string): Promise<{ created: boolean; path: string }> {
  const abs = resolvePath(manifestPath);
  try {
    await access(abs);
    return { created: false, path: abs };
  } catch (err: any) {
    if (err.code !== "ENOENT") throw err;
    await writeFile(abs, "files: []\nbibliography: references.md\n", "utf-8");
    return { created: true, path: abs };
  }
}

export function registerInitCommand(program: Command): void {
  program
    .command("init")
    .description("Initialize a document (Google Doc, markdown file, or manifest) for citation management")
    .option("--doc <docId>", "Google Doc ID")
    .option("--markdown <path>", "Markdown file path")
    .option("--manifest <path>", "Markdown manifest path")
    .option("--library <id>", "Library ID (e.g. group/12345)")
    .option("--style <style>", "Citation style", "vancouver")
    .action(async (opts) => {
      const explicitSources = [opts.doc, opts.markdown, opts.manifest].filter(Boolean);
      if (explicitSources.length > 1) {
        console.error(chalk.red("Pass at most one of --doc, --markdown, --manifest."));
        process.exit(1);
      }

      const config = await loadConfig();
      const libraryId =
        opts.library ||
        config.zotero?.defaultLibrary ||
        "local";

      try {
        if (opts.manifest) {
          const manifest = await ensureManifestFile(opts.manifest);
          if (manifest.created) {
            console.log(chalk.green(`✓ Manifest created at ${manifest.path}`));
          }
          await loadManifest(manifest.path);
          const state = await initDocStateForManifest(
            manifest.path,
            libraryId,
            opts.style as CitationStyle,
          );
          console.log(chalk.green("✓ Manifest initialized for citation management\n"));
          console.log(`  Manifest: ${manifest.path}`);
          console.log(`  StateId:  ${state.docId}`);
          console.log(`  Library:  ${state.libraryId}`);
          console.log(`  Style:    ${state.style}`);
          console.log(
            `\nUse ${chalk.cyan("cite scan --manifest <path>")} to convert pasted reference URLs and ${chalk.cyan("cite bib --manifest <path>")} to generate the bibliography.`,
          );
          return;
        }

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
