// ABOUTME: CLI command to generate or update the bibliography in a document.
// ABOUTME: Backend-agnostic: works against any DocumentSource (Google Docs, markdown, …).

import { Command } from "commander";
import { confirm } from "@inquirer/prompts";
import chalk from "chalk";
import { loadDocState, saveDocState } from "../lib/doc-state.js";
import { loadLibrary } from "../lib/library.js";
import { formatBibEntry, type CitationStyle } from "../lib/formatter.js";
import { formatBibPreview, logOperation, checkRevisionId } from "../lib/safety.js";
import { resolveSource, initHintForSource } from "../lib/resolve-source.js";

export function registerBibCommand(program: Command): void {
  program
    .command("bib")
    .description("Generate or update the bibliography section in a document")
    .option("--doc <docId>", "Google Doc ID")
    .option("--markdown <path>", "Markdown file to operate on (instead of a Google Doc)")
    .option("--style <style>", "Citation style override")
    .option("--after <text>", "Insert bibliography after this text (first time only; Google Docs only)")
    .option("--dry-run", "Preview only, do not write")
    .option("-y, --yes", "Skip confirmation prompt")
    .action(async (opts) => {
      const resolved = await resolveSource({ doc: opts.doc, markdown: opts.markdown });
      const { source, stateKey } = resolved;
      const docState = await loadDocState(stateKey);
      if (!docState) {
        console.error(chalk.red(`Document not initialized. Run '${initHintForSource(resolved)}' first.`));
        process.exit(1);
      }

      if (docState.citations.length === 0) {
        console.log(
          chalk.yellow("No citations in this document. Use 'cite scan' or 'cite insert' first."),
        );
        return;
      }

      const style = (opts.style || docState.style) as CitationStyle;
      const library = await loadLibrary(docState.libraryId);

      const sortedCitations = [...docState.citations].sort((a, b) => a.index - b.index);

      const bibEntries: string[] = [];
      for (const citation of sortedCitations) {
        const libEntry = library.find((e) => e.key === citation.key);
        if (!libEntry) {
          bibEntries.push(
            `${citation.index}. [ERROR: key "${citation.key}" not found in library]`,
          );
          continue;
        }
        bibEntries.push(formatBibEntry(citation.index, libEntry.csl, style));
      }

      const bibText = "\n\n" + bibEntries.join("\n") + "\n";

      console.log(formatBibPreview(bibEntries));
      console.log("");

      if (opts.dryRun) {
        console.log(chalk.dim("(dry-run mode — no changes made)"));
        return;
      }

      if (!opts.yes) {
        const ok = await confirm({
          message: "Write bibliography to document?",
          default: true,
        });
        if (!ok) {
          console.log("Cancelled.");
          return;
        }
      }

      console.log(`Fetching ${source.describe()}...`);
      const present = await source.findPresentCitationKeys();

      if (docState.revisionId && !checkRevisionId(docState.revisionId, present.revisionToken)) {
        console.log(
          chalk.yellow(
            "Warning: Document has been modified since last cite operation.",
          ),
        );
      }

      // Cross-check: every key tracked in state should be present in the doc.
      const stateCitationKeys = new Set(docState.citations.map((c) => c.key));
      const missing = [...stateCitationKeys].filter((k) => !present.keys.has(k));
      if (missing.length > 0) {
        const refreshHint = source.kind === "markdown"
          ? `cite refresh --markdown ${opts.markdown ?? resolved.options.markdown}`
          : `cite refresh --doc ${stateKey}`;
        console.log(
          chalk.yellow(
            `Warning: ${missing.length} citation(s) tracked in state but missing from document body: ` +
            missing.join(", ") +
            `\nRun '${refreshHint}' to repair.`,
          ),
        );
      }

      const outcome = await source.writeBibliography(bibText, {
        afterText: opts.after,
        bibRangeName: docState.bibNamedRange,
      });

      docState.bibNamedRange = outcome.bibRangeName;
      docState.lastSync = new Date().toISOString();
      docState.revisionId = outcome.newRevisionToken;
      await saveDocState(docState);

      await logOperation(
        stateKey,
        `BIB_UPDATE ${style} (${sortedCitations.length} entries)`,
      );

      console.log(
        chalk.green(
          `✓ Bibliography updated (${sortedCitations.length} entries, ${style} style)`,
        ),
      );
    });
}
