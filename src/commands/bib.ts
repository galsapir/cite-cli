// ABOUTME: CLI command to generate or update the bibliography in a Google Doc.
// ABOUTME: Supports multiple citation styles with named range tracking for updates.

import { Command } from "commander";
import { confirm } from "@inquirer/prompts";
import chalk from "chalk";
import { loadDocState, saveDocState } from "../lib/doc-state.js";
import { loadLibrary } from "../lib/library.js";
import { fetchDoc, findTextLocation, batchUpdate, findAllCitationOccurrences } from "../lib/google-docs.js";
import { formatBibEntry, type CitationStyle } from "../lib/formatter.js";
import { formatBibPreview, logOperation, checkRevisionId, validateBatchRequests, getBodyEndIndex } from "../lib/safety.js";
import { resolveDocId } from "../lib/config.js";
import type { docs_v1 } from "googleapis";

export function registerBibCommand(program: Command): void {
  program
    .command("bib")
    .description("Generate or update the bibliography section in a Google Doc")
    .option("--doc <docId>", "Google Doc ID")
    .option("--style <style>", "Citation style override")
    .option("--after <text>", "Insert bibliography after this text (first time only)")
    .option("--dry-run", "Preview only, do not write")
    .option("-y, --yes", "Skip confirmation prompt")
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

      if (docState.citations.length === 0) {
        console.log(
          chalk.yellow("No citations in this document. Use 'cite insert' first."),
        );
        return;
      }

      const style = (opts.style || docState.style) as CitationStyle; // opts.style comes from CLI string
      const library = await loadLibrary(docState.libraryId);

      // Build bibliography entries in citation order
      const sortedCitations = [...docState.citations].sort(
        (a, b) => a.index - b.index,
      );

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

      // Preview
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

      // Fetch doc to get current state
      console.log("Fetching document...");
      const doc = await fetchDoc(opts.doc);

      if (docState.revisionId && !checkRevisionId(docState.revisionId, doc.revisionId)) {
        console.log(
          chalk.yellow(
            "Warning: Document has been modified since last cite operation.",
          ),
        );
      }

      // Cross-check: verify citation named ranges exist in the document
      const docCitations = findAllCitationOccurrences(doc.namedRanges);
      const docCitationKeys = new Set(docCitations.map((c) => c.key));
      const stateKeys = new Set(docState.citations.map((c) => c.key));

      const missingRanges = [...stateKeys].filter((k) => !docCitationKeys.has(k));
      if (missingRanges.length > 0) {
        console.log(
          chalk.yellow(
            `Warning: ${missingRanges.length} citation(s) tracked in state but missing named ranges in document: ` +
            missingRanges.join(", ") +
            `\nRun 'cite refresh --doc ${opts.doc}' to repair.`,
          ),
        );
      }

      const requests: docs_v1.Schema$Request[] = [];
      const bibRangeName = docState.bibNamedRange || "cite-bibliography";
      const namedRanges = doc.namedRanges;
      // Google Docs `namedRanges[name]` is a wrapper { name, namedRanges: [...] }
      const existingRanges = namedRanges?.[bibRangeName]?.namedRanges ?? [];

      let insertIndex: number;

      if (existingRanges.length > 0) {
        // Find the range spanning the existing bibliography
        const nr = existingRanges[0];
        const range = nr.ranges?.[0];
        if (range?.startIndex != null && range?.endIndex != null) {
          insertIndex = range.startIndex;

          // Delete the old named range
          if (nr.namedRangeId) {
            requests.push({
              deleteNamedRange: { namedRangeId: nr.namedRangeId },
            });
          }

          // Delete old bibliography content
          requests.push({
            deleteContentRange: {
              range: {
                startIndex: range.startIndex,
                endIndex: range.endIndex,
              },
            },
          });
        } else {
          // Range metadata is broken — fall back to appending at end
          insertIndex = getBodyEndIndex(doc.body) - 1;
        }
      } else {
        // First time: determine insertion point
        if (opts.after) {
          const loc = findTextLocation(doc.body, opts.after);
          if (!loc) {
            console.error(
              chalk.red(`Text "${opts.after}" not found in document.`),
            );
            process.exit(1);
          }
          insertIndex = loc.endIndex;
        } else {
          insertIndex = getBodyEndIndex(doc.body) - 1;
          console.log(
            chalk.dim("  Bibliography will be appended at end of document."),
          );
        }
      }

      // Insert the new bibliography text
      requests.push({
        insertText: {
          location: { index: insertIndex },
          text: bibText,
        },
      });

      // Create a named range around the inserted bibliography so we can
      // find and replace it on subsequent runs
      requests.push({
        createNamedRange: {
          name: bibRangeName,
          range: {
            startIndex: insertIndex,
            endIndex: insertIndex + bibText.length,
          },
        },
      });

      docState.bibNamedRange = bibRangeName;

      // Pre-write safety validation
      validateBatchRequests(requests, doc.body);

      // Execute
      await batchUpdate(opts.doc, requests);

      // Update state
      docState.lastSync = new Date().toISOString();
      docState.revisionId = doc.revisionId;
      await saveDocState(docState);

      await logOperation(
        opts.doc,
        `BIB_UPDATE ${style} (${sortedCitations.length} entries)`,
      );

      console.log(
        chalk.green(
          `✓ Bibliography updated (${sortedCitations.length} entries, ${style} style)`,
        ),
      );
    });
}
