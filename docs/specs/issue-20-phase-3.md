# Multi-File Markdown Manifest (#20 Phase 3) — Spec

## Overview

Manifest-aware variants of `cite audit`, `cite refresh`, `cite remove`, `cite insert`. Builds on Phase 1A (foundation) and Phase 2 (scan/bib). After this lands, all `cite` commands except read-only utility ones (`use`, `init`, `import`, `export`, etc.) work end-to-end against `--manifest`. Issue #20 closes after Phase 3.

## Goals

- `cite audit --manifest`: union of per-file `findPresentCitationKeys`; "untracked markers" report names the file each appears in.
- `cite refresh --manifest`: rebuild `state.citations` from all-files scan using existing `firstAppearanceKeyOrder` + `rebuildMarkdownCitations` helpers; per-child revision precondition (already in place via single-source methods).
- `cite remove --manifest --key X`: delete `[@X]` everywhere across body files AND the bib file. Per-child atomic writes. Composite revisionToken.
- `cite insert --manifest --file <path>`: requires `--file` to scope the anchor to one body file (per phase 1A spec). Resolves `--file` via `path.resolve(opts.file)` and matches against `bodyChildren[].filePath`; errors with the available body file list if no match.
- Remove `rejectManifestSource` calls from all four commands (and delete the helper if no other callers remain).

## Non-Goals

- Manifest variants of `cite use`, `cite init` (already done in phases 1A/2).
- Phase 4 polish: globs in `files:`, Quarto/MkDocs interop, `cite migrate-to-manifest`.

## Technical Design

### New methods on `MultiMarkdownDocumentSource`

```ts
/** Concatenated occurrences from bodyChildren in manifest order. Each
 *  occurrence carries fileIdx so callers know which child it came from.
 *  Bib is excluded — same scan-vs-bib rule as findPresentCitationKeys. */
async scanCitationOccurrences(): Promise<MultiCitationOccurrence[]>;

interface MultiCitationOccurrence {
  fileIdx: number;
  occurrence: MarkdownCitationOccurrence; // from markdown-source.js
}

/** For audit: which body file(s) each present cite-key appears in. */
async findPresentCitationKeysByFile(): Promise<Map<string, number[]>>;
// returns key → sorted list of fileIdx where the key appears

/** Remove every `[@key]` across body AND bib children. Atomicity is
 *  per-child (existing single-source contract). On first child failure,
 *  abort and throw ManifestPartialWriteError per the Phase 2 model. */
async removeCiteKey(key: string): Promise<{
  bodyOccurrencesRemoved: number;
  bracketsRewritten: number;
  bracketsDeleted: number;
  newRevisionToken: string;
  perFile: Array<{ fileIdx: number | "bib"; removed: number }>;
}>;

/** Insert into one specific body child. fileIdx must be a valid
 *  bodyChildren index. Throws RangeError if out of bounds. */
async locateInsertionPointInFile(
  fileIdx: number,
  anchor: MarkdownInsertAnchor,
): Promise<number>;

async writeInsertionInFile(
  fileIdx: number,
  offset: number,
  marker: string,
): Promise<{ newRevisionToken: string }>;
```

`scanCitationOccurrences` and `findPresentCitationKeysByFile` walk `bodyChildren` only (bib excluded). `removeCiteKey` walks `bodyChildren` AND `bibChild` because `[@key]` may appear in either.

### Command extensions

#### `cite audit --manifest`

`audit.ts` adds `--manifest <path>` option, removes `rejectManifestSource(resolved, "audit")`. Inside the action handler, branch on `source.kind`:

- `markdown-manifest`: call `source.findPresentCitationKeysByFile()`. Compute mismatches between state.citations and present keys. Untracked markers (keys present but not in state) report includes a per-file breakdown: `[@key] appears in 02-methods.md, 04-results.md but is not tracked in state`.
- Existing `markdown` and `google-docs` branches unchanged.

Audit's "missing in body" report (state has key but body doesn't) doesn't need per-file context; it's a single state-level mismatch.

#### `cite refresh --manifest`

`refresh.ts` adds `--manifest`, removes guard. For manifest mode:

1. `await source.scanCitationOccurrences()` returns occurrences with fileIdx in manifest order.
2. Pass `occurrences.map(o => o.occurrence)` to existing `firstAppearanceKeyOrder()` helper (it operates on `MarkdownCitationOccurrence[]`; the fileIdx is metadata, not used by the order algorithm).
3. Call `rebuildMarkdownCitations(keyOrder, existingCitations, defaultLocation)` to produce the new state.citations array.
4. Each body child's `loadedRevisionToken` is set as a side effect of `scanCitationOccurrences`. Multi-source's `revisionToken()` returns the composite. Save to `docState.revisionId`.
5. Don't bother with bib in refresh — it's not part of the body-scan order.

#### `cite remove --manifest --key X`

`remove.ts` adds `--manifest`, removes guard. For manifest mode:

1. `await source.removeCiteKey(opts.key)` — single call; multi-source fans out internally.
2. Update state.citations: drop the entry with `key === opts.key`.
3. Save state with composite newRevisionToken.
4. Print summary: `Removed [@key] from N files (M occurrences total)`.

If `removeCiteKey` throws `ManifestPartialWriteError`, surface as is (already mid-run drift handling).

#### `cite insert --manifest --file <path>`

`insert.ts` adds `--manifest <path>` AND `--file <path>` options. Mutex: `--file` is required when `--manifest` is set; rejected when `--manifest` is unset (single-file insert doesn't accept `--file`).

For manifest mode:

1. Resolve `path.resolve(opts.file)` to absolute.
2. Find the index `i` such that `source.bodyChildren[i].filePath === resolved`. If no match, error:
   ```
   File '<opts.file>' is not listed in the manifest's `files:` (or is the bibliography). Available body files:
     - 00-abstract.md
     - 01-intro.md
     - …
   ```
3. Call `source.locateInsertionPointInFile(i, anchor)` to compute offset.
4. Call `source.writeInsertionInFile(i, offset, marker)` to apply.
5. Update state.citations (mirror existing single-file insert logic; track `${i}:${offset}+${marker.length}` as the namedRangeIds entry to match Phase 2's handle namespace).

Note: insert's `--file` is INVALID when `--manifest` is not passed. Single-file insert continues to use the source's filePath implicitly.

### `rejectManifestSource` cleanup

After Phase 3 lands, no command calls `rejectManifestSource`. Remove the helper from `src/lib/resolve-source.ts`. `requireGoogleDocsSource` continues to exist for Google-Docs-only commands (and still rejects `markdown-manifest`).

## Edge Cases & Error Handling

| Case | Behavior |
|---|---|
| audit: key in state, missing from all body files | Existing "missing in body" report. |
| audit: key in body, missing from state | "untracked markers" with per-file breakdown. |
| audit: key in bib but not body | Treated like "untracked" — bib is excluded from `findPresentCitationKeys`. (Acceptable: bib is auto-generated; users shouldn't be hand-citing inside it.) |
| refresh: state had key X, body no longer has it | Existing single-file behavior — drop X from state. |
| refresh: body has key X, state didn't | Existing — append X to state with next available index. |
| remove: key not present in any file | bodyOccurrencesRemoved=0; print "no occurrences found"; do NOT error. |
| remove: key in bib but not body | bibChild.removeCiteKey trims it; counted in perFile output. |
| remove: partial-write failure mid-fan-out | `ManifestPartialWriteError` per Phase 2 model. State NOT updated on partial failure. |
| insert: `--file` not in manifest | Error names the path + lists available body files. |
| insert: `--file` is the bibliography path | Error: "Inserts into the bibliography file aren't supported via --file. Use cite bib --manifest to regenerate the bibliography." |
| insert: `--file` without `--manifest` | Error: `--file is only valid with --manifest`. |
| insert: `--manifest` without `--file` | Error: `--file is required with --manifest`. |

## Tests

### `MultiMarkdownDocumentSource` (extend `test/multi-markdown-source.test.ts`)

1. `scanCitationOccurrences` returns occurrences in manifest order, each with correct fileIdx.
2. `scanCitationOccurrences` excludes bib file's occurrences.
3. `findPresentCitationKeysByFile` maps each key to the list of fileIdxs where it appears (multi-file key correctly reports both).
4. `removeCiteKey` fans out across body + bib; perFile reports each child's removal count; composite revisionToken changes.
5. `removeCiteKey` partial failure throws `ManifestPartialWriteError`.
6. `locateInsertionPointInFile(fileIdx, anchor)` delegates correctly; out-of-bounds fileIdx throws.
7. `writeInsertionInFile(fileIdx, offset, marker)` writes only to the targeted child; other body files untouched; composite revisionToken updates.

### `cite audit --manifest` (new `test/audit.manifest.test.ts`)

1. Untracked markers reported with per-file breakdown.
2. Missing-in-body reported (state has key, no body file does).
3. State + body match → "no issues" path.
4. Bib-only `[@key]` treated as untracked (since findPresentCitationKeys excludes bib).

### `cite refresh --manifest` (new `test/refresh.manifest.test.ts`)

1. State rebuilt with first-appearance order across body files in manifest order.
2. Existing state preserved when keys still present.
3. Keys removed from body but kept in state are dropped.
4. New keys appended with next index.

### `cite remove --manifest` (new `test/remove.manifest.test.ts`)

1. Removes `[@key]` from all body files + bib if present.
2. State entry for the key is dropped.
3. Removing a key that doesn't exist anywhere is a no-op (no error, "no occurrences found" message).
4. Per-file removal count reported.

### `cite insert --manifest` (new `test/insert.manifest.test.ts`)

1. `--file` resolves to a body child; insert lands in the right file at the anchor.
2. `--file` not in manifest → error names the path + lists available files.
3. `--file` is the bibliography path → error advises `cite bib`.
4. `--file` without `--manifest` → error.
5. `--manifest` without `--file` → error.
6. After-anchor + paragraph-anchor both work.

## Implementation Notes

- `scanCitationOccurrences` and `findPresentCitationKeysByFile` set each child's `loadedRevisionToken` as a side effect (calling the underlying single-source method which already does this). No need to call `establishWritePrecondition` separately.
- For `removeCiteKey` partial-write error wrapping: mirror Phase 2's `writeScanResults` partial-write handling — `try/catch` around each child's `removeCiteKey`, throw `ManifestPartialWriteError` on first failure with `Removed from N of M files. Failed at <child>: <err>...`.
- `--file` resolution: `path.resolve(opts.file)` makes the path cwd-relative, matching standard CLI conventions. If a user runs from the manifest's directory (common case), `cite insert --manifest cite.manifest.yaml --file 02-methods.md` Just Works.
- Consider extracting `--file` resolution into a small helper since both insert and any future `--file`-scoped command will need it.
