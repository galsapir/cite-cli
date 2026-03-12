import { Command } from "commander";
import { confirm } from "@inquirer/prompts";
import chalk from "chalk";
import { loadDocState, saveDocState } from "../lib/doc-state.js";
import { loadLibrary } from "../lib/library.js";
import { fetchDoc, extractText, batchUpdate } from "../lib/google-docs.js";
import { formatInlineCitation, type CitationStyle } from "../lib/formatter.js";
import { logOperation, checkRevisionId, sortRequestsReverseIndex } from "../lib/safety.js";
import { formatReference } from "../lib/format.js";
import type { docs_v1 } from "googleapis";

export function registerRemoveCommand(program: Command): void {
  program
    .command("remove")
    .description("Remove a citation from a Google Doc and renumber remaining citations")
    .requiredOption("--doc <docId>", "Google Doc ID")
    .requiredOption("--key <key>", "Citation key to remove")
    .option("--dry-run", "Preview only, do not write")
    .option("-y, --yes", "Skip confirmation prompt")
    .action(async (opts) => {
      const docState = await loadDocState(opts.doc);
      if (!docState) {
        console.error(
          chalk.red(`Doc ${opts.doc} not initialized.`),
        );
        process.exit(1);
      }

      const citation = docState.citations.find((c) => c.key === opts.key);
      if (!citation) {
        console.error(
          chalk.red(`Key "${opts.key}" is not cited in this document.`),
        );
        process.exit(1);
      }

      const library = await loadLibrary(docState.libraryId);
      const libEntry = library.find((e) => e.key === opts.key);

      console.log(chalk.bold("Will remove:"));
      console.log(`  Citation [${citation.index}] — key "${opts.key}"`);
      if (libEntry) {
        console.log(`  ${formatReference(libEntry.csl)}`);
      }

      // Check what renumbering is needed
      const higherCitations = docState.citations.filter(
        (c) => c.index > citation.index,
      );

      if (higherCitations.length > 0) {
        console.log(
          `\n${chalk.yellow("Renumbering required:")} ${higherCitations.length} citations will be renumbered`,
        );
        for (const hc of higherCitations) {
          console.log(`  [${hc.index}] → [${hc.index - 1}] (${hc.key})`);
        }
      }

      console.log("");

      if (opts.dryRun) {
        console.log(chalk.dim("(dry-run mode — no changes made)"));
        return;
      }

      if (!opts.yes) {
        const ok = await confirm({
          message: "Remove this citation and renumber?",
          default: false, // Default to No for safety
        });
        if (!ok) {
          console.log("Cancelled.");
          return;
        }
      }

      // Fetch the document
      console.log("Fetching document...");
      const doc = await fetchDoc(opts.doc);

      if (docState.revisionId && !checkRevisionId(docState.revisionId, doc.revisionId)) {
        console.log(
          chalk.yellow(
            "Warning: Document has been modified since last cite operation. " +
            "Citation positions may be stale.",
          ),
        );
      }

      const text = extractText(doc.body);

      const style = docState.style as CitationStyle;
      const requests: docs_v1.Schema$Request[] = [];

      // Find and remove the citation marker in the document
      const oldMarker = formatInlineCitation(
        [opts.key],
        [citation.index],
        style,
        libEntry ? [libEntry.csl] : [],
      );

      // Search for the marker (with potential leading space)
      const markerWithSpace = ` ${oldMarker}`;
      let markerIdx = text.indexOf(markerWithSpace);
      let markerLen = markerWithSpace.length;

      if (markerIdx === -1) {
        markerIdx = text.indexOf(oldMarker);
        markerLen = oldMarker.length;
      }

      if (markerIdx >= 0) {
        // +1 because doc body starts at index 1
        const startIdx = markerIdx + 1;
        requests.push({
          deleteContentRange: {
            range: {
              startIndex: startIdx,
              endIndex: startIdx + markerLen,
            },
          },
        });
      } else {
        console.log(
          chalk.yellow(
            `Warning: Citation marker "${oldMarker}" not found in document text. ` +
            `State will be updated but document text was not modified.`,
          ),
        );
      }

      // Renumber higher citations using position-based replacement
      // (replaceAllText would match non-citation text like "[5]" in prose)
      for (const hc of higherCitations) {
        const hcEntry = library.find((e) => e.key === hc.key);
        const oldM = formatInlineCitation(
          [hc.key],
          [hc.index],
          style,
          hcEntry ? [hcEntry.csl] : [],
        );
        const newM = formatInlineCitation(
          [hc.key],
          [hc.index - 1],
          style,
          hcEntry ? [hcEntry.csl] : [],
        );

        const renumberIdx = text.indexOf(oldM);
        if (renumberIdx >= 0) {
          const renumberStart = renumberIdx + 1; // +1: doc body starts at index 1
          requests.push({
            deleteContentRange: {
              range: {
                startIndex: renumberStart,
                endIndex: renumberStart + oldM.length,
              },
            },
          });
          requests.push({
            insertText: {
              location: { index: renumberStart },
              text: newM,
            },
          });
        } else {
          console.log(
            chalk.yellow(
              `Warning: Marker "${oldM}" not found for renumbering (key: ${hc.key}).`,
            ),
          );
        }
      }

      // Sort in reverse index order so later positions are processed first,
      // preventing earlier deletions from shifting subsequent indices
      if (requests.length > 0) {
        const sortedRequests = sortRequestsReverseIndex(requests);
        await batchUpdate(opts.doc, sortedRequests);
      }

      // Update doc state
      docState.citations = docState.citations
        .filter((c) => c.key !== opts.key)
        .map((c) => ({
          ...c,
          index: c.index > citation.index ? c.index - 1 : c.index,
        }));
      docState.lastSync = new Date().toISOString();
      docState.revisionId = doc.revisionId;
      await saveDocState(docState);

      await logOperation(
        opts.doc,
        `REMOVE [${citation.index}] (key: ${opts.key}), renumbered ${higherCitations.length} citations`,
      );

      console.log(
        chalk.green(
          `✓ Removed [${citation.index}] and renumbered ${higherCitations.length} citations`,
        ),
      );
    });
}
