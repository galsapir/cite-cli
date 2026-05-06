# Multi-File Markdown Manifest (#20 Phase 2) — Spec

## Overview

Make `cite scan` and `cite bib` end-to-end manifest-aware. Builds on Phase 1A's `MultiMarkdownDocumentSource`, manifest loader, state keying, and `cite init --manifest`. Also adds `cite use --manifest` so users can set a manifest as the active default.

## Goals & Non-Goals

### Goals
- `cite scan --manifest <path>`: walks all body files, dedupes refs against the unified library, partitions write-items per file, dispatches per-child atomic writes.
- `cite bib --manifest <path>`: writes `## References` to the file at `manifest.bibliography` only; auto-creates the bib file on first run if missing.
- `cite use --manifest <path>`: sets `defaults.manifest` in `~/.cite/config.yaml`; mirrors existing `cite use --markdown` behavior.
- `MultiMarkdownDocumentSource.writeScanResults` and `writeBibliography` implemented (replace Phase 1A throws).
- Cross-file atomicity: each child's atomic write is independent; on first failure, abort and report `wrote N of M files; failed at <file>`. State record is NOT updated on partial failure (user re-runs; `cite refresh` reconciles).
- `defaults.manifest` config field added; `resolveSource` precedence extended.

### Non-Goals (Phase 2)
- Manifest variants of audit/refresh/remove/insert (Phase 3).
- Globs in `files:`, Quarto/MkDocs interop, `cite migrate-to-manifest` (Phase 4).

## Technical Design

### `MultiMarkdownDocumentSource.writeScanResults`

```ts
async writeScanResults(
  items: ScanWriteItem[],
  style: CitationStyle,
  library: LibraryEntry[],
): Promise<ScanWriteOutcome>
```

1. Partition `items` by `(item.ref.cursor as MultiMarkdownCursor).fileIdx`. Build `Map<fileIdx, ScanWriteItem[]>`.
2. For each child with items, unwrap each item's cursor: replace `item.ref.cursor` with the inner `child` cursor (a `MarkdownCursor`). The child's `writeScanResults` expects unwrapped cursors.
3. Iterate children in fileIdx order. For each, call `child.writeScanResults(unwrappedItems, style, library)`. Each child's call handles its own atomic-write + revision precondition (already implemented).
4. **On first child failure**: abort. Re-throw the error wrapped with `Wrote N of M files. Failed at <child filePath>: <inner err>. Re-run; 'cite refresh' reconciles state.` Do NOT attempt to roll back already-written children.
5. **On success**: merge children's `occurrenceHandles` maps. Per-file handles are namespaced with fileIdx: `${fileIdx}:${childHandle}` to avoid collisions across files (e.g., two files with same offset).
6. Compute composite `newRevisionToken` via `this.revisionToken()`.
7. Return `{ occurrenceHandles, newRevisionToken }`.

### `MultiMarkdownDocumentSource.writeBibliography`

```ts
async writeBibliography(
  bibText: string,
  options: BibWriteOptions,
): Promise<BibWriteOutcome>
```

1. Ensure the bib file exists. If `bibChild.filePath` doesn't exist on disk: write an empty file (`writeFile(path, "")`). Reset `bibChild`'s cached state (cachedContent = null, loadedRevisionToken = null) so the subsequent read picks up the new empty file.
2. Delegate to `bibChild.writeBibliography(bibText, options)`. The single-file impl handles heading-replacement / append.
3. Compute composite `newRevisionToken` via `this.revisionToken()` (the bib's content is now part of it).
4. Return the child's outcome with `newRevisionToken` overridden by the composite.

### `cite scan --manifest`

In `src/commands/scan.ts`:
1. Add `--manifest <path>` option to commander.
2. Pass `manifest: opts.manifest` to `resolveSource`.
3. Remove `rejectManifestSource(resolvedSrc, "scan")` — manifest is now supported.
4. Existing scan logic Just Works: it walks `loaded.refs`, resolves them, calls `source.writeScanResults`. The source impl handles partitioning.
5. The state record gets updated per existing logic (citations, occurrence handles, revisionId). Composite revisionId from multi-source is stored as a single string — same shape as Google Docs / single markdown.

### `cite bib --manifest`

In `src/commands/bib.ts`:
1. Add `--manifest <path>` option.
2. Pass `manifest: opts.manifest` to `resolveSource`.
3. Remove `rejectManifestSource(resolved, "bib")`.
4. Update the existing `source.kind === "markdown"` refresh-hint branch to also handle manifest (refresh hint becomes `cite refresh --manifest <path>` — but `cite refresh --manifest` is Phase 3, so for Phase 2 just print the hint with `--manifest <path>` and accept it'll be a forward reference).
5. Existing bib logic Just Works.

### `cite use --manifest`

In `src/commands/use.ts`:
1. Add `--manifest <path>` option.
2. Three-way mutex with `--doc` and `--markdown` (mirror Phase 1A init's mutex).
3. Validate state record exists for the manifest (mirror existing `--markdown` behavior).
4. Set `defaults.manifest = abs`, clear `defaults.doc` and `defaults.markdown`.
5. `--clear` mode: also clear `defaults.manifest`.
6. Show mode: also display manifest if set (print `Manifest: <path>`).

### Config + Type Updates

`src/types/index.ts` `CiteConfig.defaults`:
```ts
defaults?: {
  doc?: string;
  markdown?: string;
  manifest?: string;        // new
  collection?: string;
  // …
};
```

### `resolveSource` Precedence Extension

Updated precedence: explicit `--manifest` > explicit `--markdown` > explicit `--doc` > `defaults.manifest` > `defaults.markdown` > `defaults.doc`.

Add the `defaults.manifest` check between explicit-doc dispatch and the existing `defaults.markdown` block:

```ts
const config = await loadConfig();
const activeManifest = config.defaults?.manifest;
if (!opts.doc && activeManifest) {
  const manifest = await loadManifest(activeManifest);
  const source = new MultiMarkdownDocumentSource(manifest);
  return {
    source,
    stateKey: stateKeyForSource({ type: "markdown-manifest", manifestPath: source.manifestPath }),
    options: { manifest: activeManifest },
  };
}
const activeMarkdown = config.defaults?.markdown;
// … existing markdown default block …
```

## Edge Cases & Error Handling

| Case | Behavior |
|---|---|
| Scan against manifest with empty `files: []` | `loaded.refs.length === 0` → existing "No unprocessed reference URLs found" message. No write. |
| Scan against manifest with no refs in any body file | Same — refs empty. |
| Scan: child file changed mid-run | Child's existing precondition throws `MarkdownChangedDuringRunError`. Multi-source surfaces it (does not wrap; the underlying error already names the file). |
| Scan: write fails on file 2 of 3 | First success persists. Multi-source throws `Wrote 1 of 3 files. Failed at <file2>: <inner>. Re-run; 'cite refresh' reconciles state.` State record NOT updated. |
| Bib: bib file missing on first run | Multi-source pre-creates empty file, then delegates to bibChild. |
| Bib: bib file exists with `## References` already | bibChild's existing replace-section logic handles. |
| Bib: manifest's `bibliography:` is in `files:` | bibChild may share underlying file with one of `bodyChildren` BUT `bodyChildren` filters out the bib path (Phase 1A) — so `bibChild` has no body-children twin. Writes go to `bibChild` only. |
| `cite use --manifest <path>` without prior init | Errors with "not initialized" hint pointing at `cite init --manifest <path>`. |
| `cite use --doc X --manifest Y` | Mutex error. |

## Test Plan

### `MultiMarkdownDocumentSource` (extend `test/multi-markdown-source.test.ts`)
- writeScanResults partitions items per fileIdx and dispatches to each child correctly.
- writeScanResults aborts on first child failure with the wrapped error message.
- writeScanResults handles namespacing — handles from different files don't collide.
- writeScanResults composite revisionToken changes after write.
- writeBibliography auto-creates the bib file when missing.
- writeBibliography updates an existing bib section.
- writeBibliography composite revisionToken changes after write.

### `cite scan --manifest` (new `test/scan.manifest.test.ts`)
- Scans body files only (bib excluded), inserts markers into the right files.
- Cross-file dedup: same DOI in two body files → single library entry, two markers, both with the same key.
- Partial failure: simulate write failure on file 2; assert file 1 has markers, docState NOT updated, error names file 2.
- defaults.manifest precedence honored.

### `cite bib --manifest` (new `test/bib.manifest.test.ts`)
- Bib file pre-existing and listed in `files:` → bib content replaced with `## References` block.
- Bib file missing standalone → auto-created with `## References` block.
- Body files NOT modified.
- Style override via `--style`.

### `cite use --manifest` (extend existing use tests or new `test/use.manifest.test.ts`)
- Sets defaults.manifest, clears doc + markdown defaults.
- --clear clears defaults.manifest too.
- Show mode displays manifest path.
- Uninitialized manifest path errors.
- Three-way mutex (`--doc X --manifest Y`, `--markdown X --manifest Y`).

### `resolveSource` precedence (extend `test/resolve-source.manifest.test.ts`)
- defaults.manifest used when no explicit flag.
- Explicit --markdown overrides defaults.manifest.
- Explicit --doc overrides defaults.manifest.

## Implementation Notes

- `occurrenceHandles` namespacing: `${fileIdx}:${childHandle}` — document the format in `MultiMarkdownDocumentSource` (one short comment in the merge code, since Phase 3 audit/remove may need to parse it).
- Bib auto-create: simplest impl is `await writeFile(bibChild.filePath, "")` at the top of `writeBibliography` if `access` throws ENOENT. Avoid extending `MarkdownDocumentSource` itself — keep the auto-create scoped to the manifest case.
- Mid-run revision precondition for body writes is enforced per-child (each child has its own `loadedRevisionToken` set during `loadAcademicReferences`). The multi-source doesn't need its own composite precondition for writes; trusting the children is sufficient.
- Don't add a top-level `revisionToken()` to the `DocumentSource` interface yet (deferred per Phase 1A spec).

## Open Questions

- Whether to surface the partial-write error as `ManifestChangedDuringRunError` (which is the multi-source error type) or a new `ManifestPartialWriteError`. Lean: new error type, narrower semantics. Pick at impl time.
