// ABOUTME: CLI command to remove a citation from a document source.
// ABOUTME: Google Docs uses named ranges + renumbering; markdown rewrites pandoc citation brackets.

import { Command } from "commander";
import { confirm } from "@inquirer/prompts";
import chalk from "chalk";
import { loadDocState, saveDocState } from "../lib/doc-state.js";
import { loadLibrary } from "../lib/library.js";
import { fetchDoc, extractText, batchUpdate, findCitationOccurrences } from "../lib/google-docs.js";
import { formatInlineCitation } from "../lib/formatter.js";
import { logOperation, checkRevisionId, validateBatchRequests } from "../lib/safety.js";
import { resolveSource, initHintForSource } from "../lib/resolve-source.js";
import { firstAppearanceKeyOrder, rebuildMarkdownCitations } from "../lib/markdown-citation-state.js";
import { formatReference } from "../lib/format.js";
import { CITE_RANGE_PREFIX, CITE_LINK_PREFIX } from "../types/index.js";
import type { docs_v1 } from "googleapis";
import type { DocState } from "../types/index.js";
import type { MarkdownDocumentSource } from "../lib/markdown-source.js";
import type { MultiMarkdownDocumentSource } from "../lib/multi-markdown-source.js";

export function registerRemoveCommand(program: Command): void {
  program
    .command("remove")
    .description("Remove a citation from a Google Doc and renumber remaining citations")
    .option("--doc <docId>", "Google Doc ID")
    .option("--markdown <path>", "Markdown file to operate on (instead of a Google Doc)")
    .option("--manifest <path>", "Markdown manifest to remove from")
    .requiredOption("--key <key>", "Citation key to remove")
    .option("--dry-run", "Preview only, do not write")
    .option("-y, --yes", "Skip confirmation prompt")
    .action(async (opts) => {
      const resolved = await resolveSource({ doc: opts.doc, markdown: opts.markdown, manifest: opts.manifest });
      const { source, stateKey } = resolved;
      const docState = await loadDocState(stateKey);
      if (!docState) {
        console.error(
          chalk.red(`Document not initialized. Run '${initHintForSource(resolved)}' first.`),
        );
        process.exit(1);
      }

      if (source.kind === "markdown") {
        await removeFromMarkdown(source as MarkdownDocumentSource, stateKey, docState, {
          key: opts.key,
          dryRun: Boolean(opts.dryRun),
          yes: Boolean(opts.yes),
        });
        return;
      }

      if (source.kind === "markdown-manifest") {
        await removeFromManifest(source as MultiMarkdownDocumentSource, stateKey, docState, {
          key: opts.key,
          dryRun: Boolean(opts.dryRun),
          yes: Boolean(opts.yes),
        });
        return;
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

      return await source.runWithLock(async () => {
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
      const doc = await fetchDoc(stateKey);

      if (docState.revisionId && !checkRevisionId(docState.revisionId, doc.revisionId)) {
        console.log(
          chalk.yellow(
            "Warning: Document has been modified since last cite operation. " +
            "Citation positions may be stale.",
          ),
        );
      }

      const text = extractText(doc.body);
      const style = docState.style;

      // Collect all operations: each is a set of requests at a specific
      // document position. We'll sort by reverse position before building
      // the final request array.
      interface PositionedOp {
        position: number; // sort key (reverse order)
        requests: docs_v1.Schema$Request[];
      }
      const ops: PositionedOp[] = [];

      // --- Remove the target citation's occurrences ---
      const removeOccurrences = findCitationOccurrences(doc.namedRanges, opts.key);

      if (removeOccurrences.length > 0) {
        for (const occ of removeOccurrences) {
          const reqs: docs_v1.Schema$Request[] = [];

          // Delete the named range metadata
          reqs.push({ deleteNamedRange: { namedRangeId: occ.namedRangeId } });

          // Delete the content (include leading space if present)
          let deleteStart = occ.startIndex;
          if (occ.startIndex > 1 && text[occ.startIndex - 2] === " ") {
            deleteStart = occ.startIndex - 1; // include leading space
          }
          reqs.push({
            deleteContentRange: {
              range: { startIndex: deleteStart, endIndex: occ.endIndex },
            },
          });

          ops.push({ position: occ.startIndex, requests: reqs });
        }
      } else {
        // Fallback: text search (backward compat with pre-named-range citations)
        const oldMarker = formatInlineCitation(
          [citation.index],
          style,
          libEntry ? [libEntry.csl] : [],
        );

        const markerWithSpace = ` ${oldMarker}`;
        let markerIdx = text.indexOf(markerWithSpace);
        let markerLen = markerWithSpace.length;

        if (markerIdx === -1) {
          markerIdx = text.indexOf(oldMarker);
          markerLen = oldMarker.length;
        }

        if (markerIdx >= 0) {
          const startIdx = markerIdx + 1; // +1: doc body starts at index 1
          ops.push({
            position: startIdx,
            requests: [{
              deleteContentRange: {
                range: { startIndex: startIdx, endIndex: startIdx + markerLen },
              },
            }],
          });
        } else {
          console.log(
            chalk.yellow(
              `Warning: Citation marker "${oldMarker}" not found in document text. ` +
              `State will be updated but document text was not modified.`,
            ),
          );
        }
      }

      // --- Renumber higher citations ---
      for (const hc of higherCitations) {
        const hcEntry = library.find((e) => e.key === hc.key);
        const oldMarkerText = formatInlineCitation(
          [hc.index],
          style,
          hcEntry ? [hcEntry.csl] : [],
        );
        const newMarkerText = formatInlineCitation(
          [hc.index - 1],
          style,
          hcEntry ? [hcEntry.csl] : [],
        );

        const hcOccurrences = findCitationOccurrences(doc.namedRanges, hc.key);

        if (hcOccurrences.length > 0) {
          for (const occ of hcOccurrences) {
            const reqs: docs_v1.Schema$Request[] = [];

            // Delete old named range
            reqs.push({ deleteNamedRange: { namedRangeId: occ.namedRangeId } });

            // Delete old text
            reqs.push({
              deleteContentRange: {
                range: { startIndex: occ.startIndex, endIndex: occ.endIndex },
              },
            });

            // Insert new text at the same position
            reqs.push({
              insertText: {
                location: { index: occ.startIndex },
                text: newMarkerText,
              },
            });

            // Recreate named range
            reqs.push({
              createNamedRange: {
                name: `${CITE_RANGE_PREFIX}${hc.key}`,
                range: {
                  startIndex: occ.startIndex,
                  endIndex: occ.startIndex + newMarkerText.length,
                },
              },
            });

            // Restore hyperlink
            const linkKeys = hc.key;
            reqs.push({
              updateTextStyle: {
                range: {
                  startIndex: occ.startIndex,
                  endIndex: occ.startIndex + newMarkerText.length,
                },
                textStyle: { link: { url: `${CITE_LINK_PREFIX}${linkKeys}` } },
                fields: "link",
              },
            });

            ops.push({ position: occ.startIndex, requests: reqs });
          }
        } else {
          // Fallback: text search
          const renumberIdx = text.indexOf(oldMarkerText);
          if (renumberIdx >= 0) {
            const renumberStart = renumberIdx + 1; // +1: doc body starts at index 1
            ops.push({
              position: renumberStart,
              requests: [
                {
                  deleteContentRange: {
                    range: { startIndex: renumberStart, endIndex: renumberStart + oldMarkerText.length },
                  },
                },
                {
                  insertText: {
                    location: { index: renumberStart },
                    text: newMarkerText,
                  },
                },
              ],
            });
          } else {
            console.log(
              chalk.yellow(
                `Warning: Marker "${oldMarkerText}" not found for renumbering (key: ${hc.key}).`,
              ),
            );
          }
        }
      }

      // Sort operations by reverse position (highest first) to prevent
      // earlier operations from shifting indices of later ones.
      // Within each operation, requests are already in the correct order.
      ops.sort((a, b) => b.position - a.position);

      const allRequests = ops.flatMap((op) => op.requests);

      if (allRequests.length > 0) {
        // Clear stale namedRangeIds for renumbered citations before the
        // batch update — they'll be repopulated from replies.
        for (const hc of higherCitations) {
          const entry = docState.citations.find((c) => c.key === hc.key);
          if (entry) entry.namedRangeIds = [];
        }

        // Pre-write safety validation
        validateBatchRequests(allRequests, doc.body);

        const replies = await batchUpdate(stateKey, allRequests);

        // Extract new namedRangeIds for renumbered citations from replies
        for (let i = 0; i < allRequests.length; i++) {
          const req = allRequests[i];
          const reply = replies[i];
          if (req.createNamedRange && reply?.createNamedRange?.namedRangeId) {
            const rangeName = req.createNamedRange.name || "";
            if (rangeName.startsWith(CITE_RANGE_PREFIX)) {
              const key = rangeName.slice(CITE_RANGE_PREFIX.length);
              const entry = docState.citations.find((c) => c.key === key);
              if (entry) {
                if (!entry.namedRangeIds) entry.namedRangeIds = [];
                entry.namedRangeIds.push(reply.createNamedRange.namedRangeId);
              }
            }
          }
        }
      }

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
        stateKey,
        `REMOVE [${citation.index}] (key: ${opts.key}), renumbered ${higherCitations.length} citations`,
      );

      console.log(
        chalk.green(
          `✓ Removed [${citation.index}] and renumbered ${higherCitations.length} citations`,
        ),
      );
      });
    });
}

async function removeFromManifest(
  source: MultiMarkdownDocumentSource,
  stateKey: string,
  docState: DocState,
  opts: { key: string; dryRun: boolean; yes: boolean },
): Promise<void> {
  return await source.runWithLock(async () => {
  if (!opts.yes) {
    const ok = await confirm({
      message: "Remove this citation from manifest files and state?",
      default: false,
    });
    if (!ok) {
      console.log("Cancelled.");
      return;
    }
  }

  if (opts.dryRun) {
    console.log(chalk.dim("(dry-run mode — no changes made)"));
    return;
  }

  const outcome = await source.removeCiteKey(opts.key);
  if (outcome.bodyOccurrencesRemoved === 0) {
    console.log(`No occurrences of [@${opts.key}] found in any manifest file.`);
    return;
  }

  const remainingCitations = docState.citations.filter((citation) => citation.key !== opts.key);
  const occurrences = (await source.scanCitationOccurrences()).map((item) => item.occurrence);
  const keyOrder = firstAppearanceKeyOrder(occurrences);

  docState.citations = rebuildMarkdownCitations(keyOrder, remainingCitations, "remove-rebuild");
  docState.lastSync = new Date().toISOString();
  docState.revisionId = outcome.newRevisionToken;
  await saveDocState(docState);

  await logOperation(
    stateKey,
    `REMOVE_MANIFEST key: ${opts.key}, removed ${outcome.bodyOccurrencesRemoved} occurrence(s), rewrote ${outcome.bracketsRewritten} bracket(s), deleted ${outcome.bracketsDeleted} bracket(s)`,
  );

  const changedFiles = outcome.perFile.filter((item) => item.removed > 0).length;
  console.log(chalk.green(`Removed [@${opts.key}] from ${changedFiles} file(s) (${outcome.bodyOccurrencesRemoved} occurrence(s)).`));
  });
}

async function removeFromMarkdown(
  source: MarkdownDocumentSource,
  stateKey: string,
  docState: DocState,
  opts: { key: string; dryRun: boolean; yes: boolean },
): Promise<void> {
  return await source.runWithLock(async () => {
  console.log(`Fetching ${source.describe()}...`);
  const brackets = await source.scanCitationBrackets();
  const affectedBrackets = brackets.filter((bracket) => bracket.keys.includes(opts.key));
  const stateCitation = docState.citations.find((citation) => citation.key === opts.key);

  if (affectedBrackets.length === 0 && !stateCitation) {
    console.log(`Key '${opts.key}' not found in document or state.`);
    return;
  }

  console.log(chalk.bold("Will remove:"));
  console.log(`  Citation key "${opts.key}"`);
  console.log(`  Affected citation brackets: ${affectedBrackets.length}`);
  console.log(`  State cleanup: ${stateCitation ? "yes" : "no"}`);
  if (affectedBrackets.length > 0 && !stateCitation) {
    console.log(chalk.yellow(`Warning: Key "${opts.key}" appears in the body but is not tracked in state.`));
  }
  console.log("");

  if (opts.dryRun) {
    console.log(chalk.dim("(dry-run mode — no changes made)"));
    return;
  }

  if (!opts.yes) {
    const ok = await confirm({
      message: "Remove this citation from markdown and state?",
      default: false,
    });
    if (!ok) {
      console.log("Cancelled.");
      return;
    }
  }

  const result = await source.removeCiteKey(opts.key);
  const remainingCitations = docState.citations.filter((citation) => citation.key !== opts.key);
  const occurrences = await source.scanCitationOccurrences();
  const keyOrder = firstAppearanceKeyOrder(occurrences);

  docState.citations = rebuildMarkdownCitations(keyOrder, remainingCitations, "remove-rebuild");
  docState.lastSync = new Date().toISOString();
  docState.revisionId = result.newRevisionToken;
  await saveDocState(docState);

  await logOperation(
    stateKey,
    `REMOVE_MARKDOWN key: ${opts.key}, removed ${result.bodyOccurrencesRemoved} occurrence(s), rewrote ${result.bracketsRewritten} bracket(s), deleted ${result.bracketsDeleted} bracket(s)`,
  );

  console.log(chalk.green(`✓ Removed '${opts.key}'`));
  });
}
