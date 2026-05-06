// ABOUTME: CLI command to audit citations in a document source.
// ABOUTME: Reports missing keys, numbering gaps, and orphaned entries.

import { Command } from "commander";
import chalk from "chalk";
import { loadDocState } from "../lib/doc-state.js";
import { resolveSource, initHintForSource } from "../lib/resolve-source.js";
import { loadLibrary } from "../lib/library.js";
import { fetchDoc, findAllCitationOccurrences } from "../lib/google-docs.js";
import { formatAuthors, getYear } from "../lib/format.js";
import type { MultiMarkdownDocumentSource } from "../lib/multi-markdown-source.js";

export function registerAuditCommand(program: Command): void {
  program
    .command("audit")
    .description("Audit citations in a document")
    .option("--doc <docId>", "Google Doc ID")
    .option("--markdown <path>", "Markdown file to operate on (instead of a Google Doc)")
    .option("--manifest <path>", "Markdown manifest to audit")
    .option("--offline", "Audit using local state only (skip doc fetch)")
    .action(async (opts) => {
      const resolved = await resolveSource({ doc: opts.doc, markdown: opts.markdown, manifest: opts.manifest });
      const { source, stateKey } = resolved;
      const docState = await loadDocState(stateKey);
      if (!docState) {
        console.error(chalk.red(`Document not initialized. Run '${initHintForSource(resolved)}' first.`));
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

      // Check for numbering gaps (Google Docs only — markdown uses [@key] markers, no numeric indices)
      const indices = docState.citations.map((c) => c.index).sort((a, b) => a - b);
      const gaps: number[] = [];
      if (source.kind === "google-docs") {
        for (let i = 1; i < indices.length; i++) {
          if (indices[i] !== indices[i - 1] + 1) {
            for (let g = indices[i - 1] + 1; g < indices[i]; g++) {
              gaps.push(g);
            }
          }
        }
      }

      // Body cross-check via the source's view of present cite-keys.
      // Markdown gets its file path as title even when --offline.
      const presentCitationKeys = new Set<string>();
      let presentCitationKeysByFile = new Map<string, number[]>();
      // Bib-only keys — present in the generated bibliography but not the
      // body. Kept separate from presentCitationKeys so the body-vs-state
      // checks aren't fooled by a stale bib still containing a deleted key.
      let presentBibOnlyKeys = new Set<string>();
      let docTitle = source.kind === "markdown" ? source.describe() : "(offline mode)";
      if (source.kind === "markdown-manifest") docTitle = source.describe();
      let bodyChecked = false;
      if (!opts.offline) {
        try {
          if (source.kind === "google-docs") {
            // Single fetch — use the same doc payload for both title and body keys.
            const doc = await fetchDoc(stateKey);
            docTitle = doc.title;
            for (const occ of findAllCitationOccurrences(doc.namedRanges)) {
              presentCitationKeys.add(occ.key);
            }
          } else {
            await source.runWithLock(async () => {
              if (source.kind === "markdown-manifest") {
                const manifestSource = source as MultiMarkdownDocumentSource;
                presentCitationKeysByFile = await manifestSource.findPresentCitationKeysByFile();
                for (const key of presentCitationKeysByFile.keys()) presentCitationKeys.add(key);
                const bibPresent = await manifestSource.bibChild.findPresentCitationKeys();
                presentBibOnlyKeys = new Set([...bibPresent.keys].filter((k) => !presentCitationKeys.has(k)));
              } else {
                const present = await source.findPresentCitationKeys();
                for (const k of present.keys) presentCitationKeys.add(k);
              }
            });
          }
          bodyChecked = true;
        } catch {
          console.log(
            chalk.yellow("Could not fetch document. Using offline mode.\n"),
          );
          docTitle = "(could not fetch)";
        }
      }

      // Report
      console.log(chalk.bold(`\nDocument: "${docTitle}"`));
      console.log(`State ID: ${stateKey}`);
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

      if (source.kind === "google-docs") {
        if (gaps.length > 0) {
          console.log(`Numbering gaps: ${chalk.yellow(gaps.join(", "))}`);
        } else {
          console.log(`Numbering gaps: ${chalk.green("none")}`);
        }
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

      if (bodyChecked) {
        const trackedKeys = new Set(docState.citations.map((c) => c.key));
        const untrackedInDoc = [...presentCitationKeys].filter(
          (key) => !trackedKeys.has(key),
        );
        const missingFromDoc = [...trackedKeys].filter(
          (key) => !presentCitationKeys.has(key),
        );
        if (untrackedInDoc.length > 0) {
          if (source.kind === "markdown-manifest") {
            const manifestSource = source as MultiMarkdownDocumentSource;
            console.log(`\n${chalk.yellow("Untracked markers (in body but not in state):")}`);
            for (const key of untrackedInDoc) {
              const filePaths = presentCitationKeysByFile.get(key) ?? [];
              const labels = filePaths.map((idx) => manifestSource.bodyChildren[idx].filePath);
              console.log(`  @${key} appears in ${labels.join(", ")} but is not tracked in state`);
            }
          } else {
            const formatted = untrackedInDoc.map((key) =>
              source.kind === "markdown" ? `@${key}` : key,
            );
            console.log(
              `\n${chalk.yellow("Untracked markers in doc:")} ${formatted.join(", ")}`,
            );
          }
        }
        if (missingFromDoc.length > 0) {
          console.log(
            `\n${chalk.yellow("Citations missing from doc body:")} ${missingFromDoc.join(", ")}`,
          );
        }
        if (source.kind === "markdown-manifest" && presentBibOnlyKeys.size > 0) {
          // Informational: bib-only keys may be stale entries left in the
          // generated bibliography after their body citations were deleted.
          // Run 'cite bib --manifest' to regenerate the bib block.
          const manifestSource = source as MultiMarkdownDocumentSource;
          console.log(
            `\n${chalk.dim("Bibliography contains keys not present in body:")} ` +
            [...presentBibOnlyKeys].map((k) => `@${k}`).join(", "),
          );
          console.log(chalk.dim(`  (${manifestSource.bibChild.filePath} — re-run 'cite bib --manifest' to regenerate.)`));
        }
      }

      console.log("");
    });
}
