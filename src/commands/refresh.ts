// ABOUTME: CLI command to repair and reconcile citations in a Google Doc.
// ABOUTME: Reconstructs named ranges from hyperlinks and renumbers in document order.

import { Command } from "commander";
import { confirm } from "@inquirer/prompts";
import chalk from "chalk";
import { loadDocState, saveDocState } from "../lib/doc-state.js";
import { loadLibrary } from "../lib/library.js";
import {
  fetchDoc,
  batchUpdate,
  findAllCitationOccurrences,
  findCitationHyperlinks,
  type CitationOccurrence,
} from "../lib/google-docs.js";
import { formatInlineCitation } from "../lib/formatter.js";
import { logOperation, validateBatchRequests } from "../lib/safety.js";
import { resolveSource, initHintForSource } from "../lib/resolve-source.js";
import { firstAppearanceKeyOrder, rebuildMarkdownCitations } from "../lib/markdown-citation-state.js";
import { CITE_RANGE_PREFIX, CITE_LINK_PREFIX } from "../types/index.js";
import type { docs_v1 } from "googleapis";
import type { CitationEntry, DocState } from "../types/index.js";
import type { MarkdownDocumentSource } from "../lib/markdown-source.js";

export function registerRefreshCommand(program: Command): void {
  program
    .command("refresh")
    .description("Repair citations: reconstruct named ranges from hyperlinks and renumber in document order")
    .option("--doc <docId>", "Google Doc ID")
    .option("--markdown <path>", "Markdown file to operate on (instead of a Google Doc)")
    .option("--dry-run", "Preview only, do not write")
    .option("-y, --yes", "Skip confirmation prompt")
    .action(async (opts) => {
      const resolved = await resolveSource({ doc: opts.doc, markdown: opts.markdown });
      const { source, stateKey } = resolved;
      const docState = await loadDocState(stateKey);
      if (!docState) {
        console.error(
          chalk.red(`Document not initialized. Run '${initHintForSource(resolved)}' first.`),
        );
        process.exit(1);
      }

      if (source.kind === "markdown") {
        await refreshMarkdownSource(source as MarkdownDocumentSource, stateKey, docState, {
          dryRun: Boolean(opts.dryRun),
          yes: Boolean(opts.yes),
        });
        return;
      }

      const library = await loadLibrary(docState.libraryId);
      const libraryKeys = new Set(library.map((e) => e.key));

      console.log("Fetching document...");
      const doc = await fetchDoc(stateKey);
      console.log(`  Document: "${doc.title}"`);

      // Step 1: Collect all citations from named ranges
      const namedRangeOccurrences = findAllCitationOccurrences(doc.namedRanges);

      // Step 2: Collect all citation hyperlinks
      const hyperlinks = findCitationHyperlinks(doc.body);

      // Step 3: Find orphaned hyperlinks (have link but no named range)
      const rangedPositions = new Set(
        namedRangeOccurrences.map((o) => `${o.startIndex}:${o.endIndex}`),
      );

      const orphanedHyperlinks = hyperlinks.filter(
        (h) => !rangedPositions.has(`${h.startIndex}:${h.endIndex}`),
      );

      // Build a unified list of all citation positions in document order
      interface CitationPosition {
        keys: string[];
        startIndex: number;
        endIndex: number;
        hasNamedRange: boolean;
        namedRangeId?: string;
      }

      const allPositions: CitationPosition[] = [];

      // Add positions from named ranges
      for (const occ of namedRangeOccurrences) {
        allPositions.push({
          keys: [occ.key],
          startIndex: occ.startIndex,
          endIndex: occ.endIndex,
          hasNamedRange: true,
          namedRangeId: occ.namedRangeId,
        });
      }

      // Add orphaned hyperlinks (these lost their named range, e.g. via copy/paste)
      for (const h of orphanedHyperlinks) {
        allPositions.push({
          keys: h.keys,
          startIndex: h.startIndex,
          endIndex: h.endIndex,
          hasNamedRange: false,
        });
      }

      // Sort by document position (ascending)
      allPositions.sort((a, b) => a.startIndex - b.startIndex);

      // Deduplicate overlapping positions (prefer the one with a named range)
      const deduped: CitationPosition[] = [];
      for (const pos of allPositions) {
        const prev = deduped[deduped.length - 1];
        if (prev && prev.startIndex === pos.startIndex && prev.endIndex === pos.endIndex) {
          // Same position — keep the one with a named range
          if (pos.hasNamedRange && !prev.hasNamedRange) {
            deduped[deduped.length - 1] = pos;
          }
          continue;
        }
        deduped.push(pos);
      }

      // Report findings
      console.log(`\n${chalk.bold("Document analysis:")}`);
      console.log(`  Named range citations: ${namedRangeOccurrences.length}`);
      console.log(`  Hyperlink citations: ${hyperlinks.length}`);
      console.log(`  Orphaned hyperlinks (need repair): ${orphanedHyperlinks.length}`);
      console.log(`  Total citation positions: ${deduped.length}`);

      // Filter to known keys only
      const validPositions = deduped.filter((p) =>
        p.keys.some((k) => libraryKeys.has(k)),
      );

      const unknownKeys = deduped
        .flatMap((p) => p.keys)
        .filter((k) => !libraryKeys.has(k));
      if (unknownKeys.length > 0) {
        console.log(
          chalk.yellow(`  Unknown keys (not in library): ${[...new Set(unknownKeys)].join(", ")}`),
        );
      }

      if (validPositions.length === 0) {
        console.log(chalk.yellow("\nNo citation positions found to refresh."));
        return;
      }

      // Assign new indices in document order.
      // Each unique key gets a number in first-appearance order.
      const keyOrder: string[] = [];
      for (const pos of validPositions) {
        for (const key of pos.keys) {
          if (libraryKeys.has(key) && !keyOrder.includes(key)) {
            keyOrder.push(key);
          }
        }
      }

      const keyToIndex = new Map<string, number>();
      keyOrder.forEach((key, i) => keyToIndex.set(key, i + 1));

      // Preview renumbering
      console.log(`\n${chalk.bold("Renumbering plan:")}`);
      for (const [key, idx] of keyToIndex) {
        const libEntry = library.find((e) => e.key === key);
        const title = libEntry?.csl.title?.slice(0, 60) || "?";
        console.log(`  [${idx}] ${key} — ${title}`);
      }

      if (orphanedHyperlinks.length > 0) {
        console.log(`\n${chalk.bold("Will repair:")} ${orphanedHyperlinks.length} orphaned hyperlink(s)`);
      }

      console.log("");

      if (opts.dryRun) {
        console.log(chalk.dim("(dry-run mode — no changes made)"));
        return;
      }

      if (!opts.yes) {
        const ok = await confirm({
          message: "Apply refresh?",
          default: true,
        });
        if (!ok) {
          console.log("Cancelled.");
          return;
        }
      }

      // Build batch update requests.
      // Process positions in reverse document order to avoid index shifting.
      const style = docState.style;
      interface PositionedOp {
        position: number;
        requests: docs_v1.Schema$Request[];
      }
      const ops: PositionedOp[] = [];

      for (const pos of [...validPositions].reverse()) {
        const reqs: docs_v1.Schema$Request[] = [];
        const primaryKey = pos.keys.find((k) => libraryKeys.has(k))!;
        const indices = pos.keys
          .filter((k) => libraryKeys.has(k))
          .map((k) => keyToIndex.get(k)!)
          .sort((a, b) => a - b);

        const cslEntries = pos.keys
          .filter((k) => libraryKeys.has(k))
          .map((k) => library.find((e) => e.key === k)!.csl);

        const newMarker = formatInlineCitation(indices, style, cslEntries);

        // Delete existing named range if present
        if (pos.hasNamedRange && pos.namedRangeId) {
          reqs.push({ deleteNamedRange: { namedRangeId: pos.namedRangeId } });
        }

        // Replace the content: delete old, insert new
        reqs.push({
          deleteContentRange: {
            range: { startIndex: pos.startIndex, endIndex: pos.endIndex },
          },
        });

        reqs.push({
          insertText: {
            location: { index: pos.startIndex },
            text: newMarker,
          },
        });

        // Create named range(s) for each key
        for (const key of pos.keys.filter((k) => libraryKeys.has(k))) {
          reqs.push({
            createNamedRange: {
              name: `${CITE_RANGE_PREFIX}${key}`,
              range: {
                startIndex: pos.startIndex,
                endIndex: pos.startIndex + newMarker.length,
              },
            },
          });
        }

        // Add/update hyperlink
        const linkKeys = pos.keys.filter((k) => libraryKeys.has(k)).join(",");
        reqs.push({
          updateTextStyle: {
            range: {
              startIndex: pos.startIndex,
              endIndex: pos.startIndex + newMarker.length,
            },
            textStyle: { link: { url: `${CITE_LINK_PREFIX}${linkKeys}` } },
            fields: "link",
          },
        });

        ops.push({ position: pos.startIndex, requests: reqs });
      }

      const allRequests = ops.flatMap((op) => op.requests);

      if (allRequests.length === 0) {
        console.log(chalk.green("✓ No changes needed."));
        return;
      }

      // Validate and execute
      validateBatchRequests(allRequests, doc.body);
      const replies = await batchUpdate(stateKey, allRequests);

      // Rebuild doc state from the new numbering
      const newCitations: CitationEntry[] = [];
      let replyIdx = 0;

      for (const op of ops) {
        const namedRangeIds: string[] = [];
        for (const req of op.requests) {
          const reply = replies[replyIdx];
          if (req.createNamedRange && reply?.createNamedRange?.namedRangeId) {
            namedRangeIds.push(reply.createNamedRange.namedRangeId);
          }
          replyIdx++;
        }

        // This op corresponds to one of the validPositions (in reverse).
        // We don't strictly need to track which — we rebuild from keyOrder.
      }

      // Rebuild citations from keyOrder
      for (const [key, idx] of keyToIndex) {
        const existing = docState.citations.find((c) => c.key === key);
        newCitations.push({
          index: idx,
          key,
          location: existing?.location || "refresh",
          // namedRangeIds will be refreshed on next operation
        });
      }

      docState.citations = newCitations;
      docState.lastSync = new Date().toISOString();
      docState.revisionId = doc.revisionId;
      await saveDocState(docState);

      await logOperation(
        stateKey,
        `REFRESH: ${validPositions.length} positions, ${orphanedHyperlinks.length} repairs, ${keyOrder.length} unique keys`,
      );

      console.log(
        chalk.green(
          `✓ Refreshed ${validPositions.length} citation(s), repaired ${orphanedHyperlinks.length} orphaned link(s)`,
        ),
      );
    });
}

async function refreshMarkdownSource(
  source: MarkdownDocumentSource,
  stateKey: string,
  docState: DocState,
  opts: { dryRun: boolean; yes: boolean },
): Promise<void> {
  console.log(`Fetching ${source.describe()}...`);
  const occurrences = await source.scanCitationOccurrences();
  const revisionToken = await source.revisionToken();

  const keyOrder = firstAppearanceKeyOrder(occurrences);
  const rebuilt = rebuildMarkdownCitations(keyOrder, docState.citations, "refresh");
  const dropped = docState.citations
    .map((citation) => citation.key)
    .filter((key) => !keyOrder.includes(key));
  const added = keyOrder.filter(
    (key) => !docState.citations.some((citation) => citation.key === key),
  );
  const renumbered = rebuilt.filter((citation) => {
    const existing = docState.citations.find((current) => current.key === citation.key);
    return existing && existing.index !== citation.index;
  });

  console.log(`  Citation markers: ${occurrences.length}`);
  console.log(`  Unique citation keys: ${keyOrder.length}`);

  if (dropped.length > 0) {
    console.log(chalk.yellow(`Warning: Dropped citations: ${dropped.join(", ")}`));
  }
  if (added.length > 0) {
    console.log(chalk.yellow(`Warning: Added citations: ${added.join(", ")}`));
  }

  console.log(`\n${chalk.bold("Renumbering plan:")}`);
  if (rebuilt.length === 0) {
    console.log(chalk.dim("  (no citations)"));
  } else {
    for (const citation of rebuilt) {
      const previous = docState.citations.find((current) => current.key === citation.key);
      const suffix = previous && previous.index !== citation.index
        ? chalk.dim(` (was ${previous.index})`)
        : "";
      console.log(`  [${citation.index}] ${citation.key}${suffix}`);
    }
  }

  if (opts.dryRun) {
    console.log(chalk.dim("\n(dry-run mode — no changes made)"));
    return;
  }

  if (
    dropped.length === 0 &&
    added.length === 0 &&
    renumbered.length === 0 &&
    citationsEqual(docState.citations, rebuilt)
  ) {
    console.log(chalk.green("\n✓ No changes needed."));
    return;
  }

  if (!opts.yes) {
    const ok = await confirm({
      message: "Apply refresh?",
      default: true,
    });
    if (!ok) {
      console.log("Cancelled.");
      return;
    }
  }

  docState.citations = rebuilt;
  docState.lastSync = new Date().toISOString();
  docState.revisionId = revisionToken;
  await saveDocState(docState);

  await logOperation(
    stateKey,
    `REFRESH_MARKDOWN: ${occurrences.length} markers, ${keyOrder.length} unique keys`,
  );

  console.log(chalk.green(`\n✓ Refreshed ${keyOrder.length} citation(s)`));
}

function citationsEqual(left: CitationEntry[], right: CitationEntry[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
