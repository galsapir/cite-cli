// ABOUTME: CLI command to audit citations in a Google Doc.
// ABOUTME: Reports missing keys, numbering gaps, and orphaned entries.

import { Command } from "commander";
import chalk from "chalk";
import { loadDocState } from "../lib/doc-state.js";
import { resolveDocId } from "../lib/config.js";
import { loadLibrary } from "../lib/library.js";
import { fetchDoc, extractText } from "../lib/google-docs.js";
import { formatAuthors, getYear } from "../lib/format.js";

export function registerAuditCommand(program: Command): void {
  program
    .command("audit")
    .description("Audit citations in a Google Doc")
    .option("--doc <docId>", "Google Doc ID")
    .option("--offline", "Audit using local state only (skip doc fetch)")
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

      const library = await loadLibrary(docState.libraryId);
      const libraryKeys = new Set(library.map((e) => e.key));
      const citedKeys = new Set(docState.citations.map((c) => c.key));

      // Check citations against library
      const missingFromLibrary: { index: number; key: string }[] = [];
      const validCitations: { index: number; key: string }[] = [];

      for (const citation of docState.citations) {
        if (libraryKeys.has(citation.key)) {
          validCitations.push(citation);
        } else {
          missingFromLibrary.push(citation);
        }
      }

      // Find orphaned library entries (in library but not cited)
      const orphaned = library.filter((e) => !citedKeys.has(e.key));

      // Check for numbering gaps
      const indices = docState.citations.map((c) => c.index).sort((a, b) => a - b);
      const gaps: number[] = [];
      for (let i = 1; i < indices.length; i++) {
        if (indices[i] !== indices[i - 1] + 1) {
          for (let g = indices[i - 1] + 1; g < indices[i]; g++) {
            gaps.push(g);
          }
        }
      }

      // If online, also scan the document for citation markers
      let docCitations: number[] = [];
      let docTitle = "(offline mode)";
      if (!opts.offline) {
        try {
          const doc = await fetchDoc(opts.doc);
          docTitle = doc.title;
          const text = extractText(doc.body);

          // Find all [N] patterns in the document
          const markerRegex = /\[(\d+)\]/g;
          let match;
          while ((match = markerRegex.exec(text)) !== null) {
            docCitations.push(parseInt(match[1]));
          }
        } catch {
          console.log(
            chalk.yellow("Could not fetch document. Using offline mode.\n"),
          );
          docTitle = "(could not fetch)";
        }
      }

      // Report
      console.log(chalk.bold(`\nDocument: "${docTitle}"`));
      console.log(`Doc ID: ${opts.doc}`);
      console.log(`Library: ${docState.libraryId}`);
      console.log(`Style: ${docState.style}`);
      console.log(`Last sync: ${docState.lastSync}\n`);

      console.log(
        `Citations tracked: ${chalk.bold(docState.citations.length.toString())}`,
      );
      console.log(
        `Library matches: ${chalk.green(`${validCitations.length} ✓`)}`,
      );

      if (missingFromLibrary.length > 0) {
        console.log(
          `Missing from library: ${chalk.red(`${missingFromLibrary.length} ✗`)}`,
        );
        for (const m of missingFromLibrary) {
          console.log(chalk.red(`  [${m.index}] — key "${m.key}" not found`));
        }
      }

      if (gaps.length > 0) {
        console.log(`Numbering gaps: ${chalk.yellow(gaps.join(", "))}`);
      } else {
        console.log(`Numbering gaps: ${chalk.green("none")}`);
      }

      if (orphaned.length > 0) {
        console.log(
          `\nOrphaned library entries (not cited): ${chalk.yellow(orphaned.length.toString())}`,
        );
        for (const o of orphaned) {
          const authors = formatAuthors(o.csl.author);
          const year = getYear(o.csl);
          console.log(chalk.dim(`  - ${o.key} (${authors}, ${year})`));
        }
      }

      if (docCitations.length > 0) {
        // Check for markers in doc that aren't tracked
        const trackedIndices = new Set(docState.citations.map((c) => c.index));
        const untrackedInDoc = [...new Set(docCitations)].filter(
          (n) => !trackedIndices.has(n),
        );
        if (untrackedInDoc.length > 0) {
          console.log(
            `\n${chalk.yellow("Untracked markers in doc:")} ${untrackedInDoc.map((n) => `[${n}]`).join(", ")}`,
          );
        }
      }

      console.log("");
    });
}
