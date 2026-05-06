// ABOUTME: CLI command to set the active document and collection for a working session.
// ABOUTME: Stores defaults in config so subsequent commands don't need --doc/--markdown/--collection flags.

import { Command } from "commander";
import chalk from "chalk";
import { resolve as resolvePath } from "node:path";
import { loadConfig, updateConfig } from "../lib/config.js";
import { loadDocState, stateKeyForSource } from "../lib/doc-state.js";
import { fetchDoc } from "../lib/google-docs.js";

export function registerUseCommand(program: Command): void {
  program
    .command("use")
    .description("Set (or show) the active document and collection")
    .option("--doc <docId>", "Google Doc ID to work with")
    .option("--markdown <path>", "Markdown file to work with")
    .option("--manifest <path>", "Markdown manifest file to work with")
    .option("--collection <name>", "Default Zotero collection for new references")
    .option("--clear", "Clear the active doc, markdown file, and collection")
    .action(async (opts) => {
      if ([opts.doc, opts.markdown, opts.manifest].filter(Boolean).length > 1) {
        console.error(chalk.red("Pass at most one of --doc, --markdown, --manifest."));
        process.exit(1);
      }

      const config = await loadConfig();

      // Clear mode
      if (opts.clear) {
        await updateConfig({
          defaults: {
            ...config.defaults,
            doc: undefined,
            markdown: undefined,
            manifest: undefined,
            collection: undefined,
          },
        });
        console.log(chalk.green("✓ Cleared active document, markdown file, and collection."));
        return;
      }

      // Set mode — at least one option provided
      if (opts.doc || opts.markdown || opts.manifest || opts.collection) {
        const updates: Record<string, any> = { ...config.defaults };

        if (opts.doc) {
          const docState = await loadDocState(opts.doc);
          if (!docState) {
            console.error(
              chalk.red(
                `Doc ${opts.doc} not initialized. Run 'cite init --doc ${opts.doc}' first.`,
              ),
            );
            process.exit(1);
          }
          updates.doc = opts.doc;
          updates.markdown = undefined;
          updates.manifest = undefined;
        }

        if (opts.markdown) {
          const abs = resolvePath(opts.markdown);
          const stateKey = stateKeyForSource({ type: "markdown", filePath: abs });
          const docState = await loadDocState(stateKey);
          if (!docState) {
            console.error(
              chalk.red(
                `Markdown file ${opts.markdown} not initialized. Run 'cite init --markdown ${opts.markdown}' first.`,
              ),
            );
            process.exit(1);
          }
          updates.markdown = abs;
          updates.doc = undefined;
          updates.manifest = undefined;
        }

        if (opts.manifest) {
          const abs = resolvePath(opts.manifest);
          const stateKey = stateKeyForSource({ type: "markdown-manifest", manifestPath: abs });
          const docState = await loadDocState(stateKey);
          if (!docState) {
            console.error(
              chalk.red(
                `Manifest ${opts.manifest} not initialized. Run 'cite init --manifest ${opts.manifest}' first.`,
              ),
            );
            process.exit(1);
          }
          updates.manifest = abs;
          updates.doc = undefined;
          updates.markdown = undefined;
        }

        if (opts.collection) {
          updates.collection = opts.collection;
        }

        await updateConfig({ defaults: updates });

        if (opts.doc) console.log(chalk.green(`✓ Active document: ${opts.doc}`));
        if (opts.markdown) console.log(chalk.green(`✓ Active markdown file: ${opts.markdown}`));
        if (opts.manifest) console.log(chalk.green(`✓ Active manifest: ${opts.manifest}`));
        if (opts.collection) console.log(chalk.green(`✓ Active collection: ${opts.collection}`));
        return;
      }

      // Show mode — no options, display current state
      const docId = config.defaults?.doc;
      const markdown = config.defaults?.markdown;
      const manifest = config.defaults?.manifest;
      const collection = config.defaults?.collection;
      const style = config.defaults?.style;

      if (!docId && !markdown && !manifest && !collection) {
        console.log(chalk.dim("No active document or collection set."));
        console.log(chalk.dim("Use: cite use --doc <DOC_ID>  OR  cite use --markdown <PATH>  OR  cite use --manifest <PATH>"));
        return;
      }

      if (docId) {
        let title = docId;
        try {
          const doc = await fetchDoc(docId);
          title = `${doc.title} (${docId.slice(0, 12)}...)`;
        } catch {
          // Can't fetch title — just show ID
        }
        const docState = await loadDocState(docId);
        console.log(`Document:   ${chalk.cyan(title)}`);
        if (docState) {
          console.log(`Library:    ${docState.libraryId}`);
          console.log(`Style:      ${docState.style}`);
          console.log(`Citations:  ${docState.citations.length}`);
        }
      }

      if (markdown) {
        const stateKey = stateKeyForSource({ type: "markdown", filePath: markdown });
        const docState = await loadDocState(stateKey);
        console.log(`Markdown:   ${chalk.cyan(markdown)}`);
        if (docState) {
          console.log(`Library:    ${docState.libraryId}`);
          console.log(`Style:      ${docState.style}`);
          console.log(`Citations:  ${docState.citations.length}`);
        }
      }

      if (manifest) {
        const stateKey = stateKeyForSource({ type: "markdown-manifest", manifestPath: manifest });
        const docState = await loadDocState(stateKey);
        console.log(`Manifest:   ${chalk.cyan(manifest)}`);
        if (docState) {
          console.log(`Library:    ${docState.libraryId}`);
          console.log(`Style:      ${docState.style}`);
          console.log(`Citations:  ${docState.citations.length}`);
        }
      }

      if (collection) {
        console.log(`Collection: ${chalk.cyan(collection)}`);
      }

      if (style && !docId && !markdown && !manifest) {
        console.log(`Style:      ${style}`);
      }
    });
}
