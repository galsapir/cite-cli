// ABOUTME: CLI command to set the active document and collection for a working session.
// ABOUTME: Stores defaults in config so subsequent commands don't need --doc/--collection flags.

import { Command } from "commander";
import chalk from "chalk";
import { loadConfig, updateConfig } from "../lib/config.js";
import { loadDocState } from "../lib/doc-state.js";
import { fetchDoc } from "../lib/google-docs.js";

export function registerUseCommand(program: Command): void {
  program
    .command("use")
    .description("Set (or show) the active document and collection")
    .option("--doc <docId>", "Google Doc ID to work with")
    .option("--collection <name>", "Default Zotero collection for new references")
    .option("--clear", "Clear the active doc and collection")
    .action(async (opts) => {
      const config = await loadConfig();

      // Clear mode
      if (opts.clear) {
        await updateConfig({
          defaults: {
            ...config.defaults,
            doc: undefined,
            collection: undefined,
          },
        });
        console.log(chalk.green("✓ Cleared active document and collection."));
        return;
      }

      // Set mode — at least one option provided
      if (opts.doc || opts.collection) {
        const updates: Record<string, any> = { ...config.defaults };

        if (opts.doc) {
          // Validate the doc is initialized
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
        }

        if (opts.collection) {
          updates.collection = opts.collection;
        }

        await updateConfig({ defaults: updates });

        // Show what was set
        if (opts.doc) console.log(chalk.green(`✓ Active document: ${opts.doc}`));
        if (opts.collection) console.log(chalk.green(`✓ Active collection: ${opts.collection}`));
        return;
      }

      // Show mode — no options, display current state
      const docId = config.defaults?.doc;
      const collection = config.defaults?.collection;
      const style = config.defaults?.style;

      if (!docId && !collection) {
        console.log(chalk.dim("No active document or collection set."));
        console.log(chalk.dim("Use: cite use --doc <DOC_ID> --collection <name>"));
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

      if (collection) {
        console.log(`Collection: ${chalk.cyan(collection)}`);
      }

      if (style && !config.defaults?.doc) {
        console.log(`Style:      ${style}`);
      }
    });
}
