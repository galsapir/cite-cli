# Per-file Advisory Lock for `cite` (#15) — Spec

## Overview

Add a per-file advisory lock around the `cite` load→write window so two concurrent `cite` processes on the same markdown file (or manifest) can't last-writer-wins each other's edits. Atomic write + revision precondition (already in place) protect against crashes and external editor edits, but two `cite` runs whose load windows overlap will both see the same starting revision and silently overwrite each other.

## Goals

- Per-`MarkdownDocumentSource` advisory lock (sibling `<file>.cite.lock` file) acquired before any load, released after any write completes (success or failure).
- Multi-source acquires a lock on every child path (body + bib) for the duration of an operation. Locks acquired in a deterministic order (manifest file order) to avoid deadlock between two manifest runs.
- Lock acquisition has a sane timeout (default 5s); on timeout throw `MarkdownLockTimeoutError` naming the file.
- Stale lock detection: if the process holding the lock has died, the lock should be claimable.

## Non-Goals

- Distributed locks (NFS, network FS). `proper-lockfile`'s default behavior on local FS is sufficient.
- Locking Google Docs sources (Google's revisionId already provides write-precondition semantics).

## Design

### Dependency

Add `proper-lockfile` (~3KB, mature, handles stale detection + retry + cross-platform). Use defaults except for our timeout.

### API

Add to `MarkdownDocumentSource`:

```ts
async runWithLock<T>(operation: () => Promise<T>): Promise<T>;
```

Acquires sibling `<file>.cite.lock` with `proper-lockfile.lock(filePath, { stale: 30_000, retries: { retries: 5, factor: 1.5, minTimeout: 100, maxTimeout: 1000 } })` (~5s total). On timeout throw `MarkdownLockTimeoutError(filePath)`. Run `operation()`, release in `finally`. Re-throw any operation error.

Add to `MultiMarkdownDocumentSource`:

```ts
async runWithLock<T>(operation: () => Promise<T>): Promise<T>;
```

Acquire locks on every child path (body files in manifest order, then bib if not already in body) sequentially. On any acquire failure, release already-held locks and re-throw. Run operation. Release all locks in reverse order in `finally`.

Add to `DocumentSource` interface:

```ts
runWithLock<T>(operation: () => Promise<T>): Promise<T>;
```

`GoogleDocsSource.runWithLock`: just invokes the operation (no-op wrapper; gdocs concurrency lives in Google's revisionId).

### New error

```ts
export class MarkdownLockTimeoutError extends Error {
  constructor(filePath: string) {
    super(
      `Could not acquire lock on ${filePath} within timeout. Another 'cite' process may be running. ` +
      `If you're sure no other process holds it, remove ${filePath}.cite.lock and re-run.`,
    );
    this.name = "MarkdownLockTimeoutError";
  }
}
```

### Call sites

Wrap the load→write block in each command:
- `scan.ts`: wrap the body of the action handler from `loadAcademicReferences` through `saveDocState`.
- `bib.ts`: wrap from `findPresentCitationKeys` through `saveDocState`.
- `audit.ts`, `refresh.ts`, `remove.ts`, `insert.ts`: wrap the analogous load→write window.

Use `await source.runWithLock(async () => { ... })`.

### Lock file location

Sibling `<file>.cite.lock` (proper-lockfile's default). Add `*.cite.lock` to `.gitignore`.

For `MultiMarkdownDocumentSource`: lock the manifest file too (acquire its own `.cite.lock`) AND each body/bib file. The manifest file lock prevents two `cite` runs on the same manifest from overlapping. Body/bib locks prevent overlap with single-file `cite` runs on individual children.

Actually simpler: just lock the per-child files. The manifest text itself is hashed into the revision token, so concurrent edits to the manifest are detected via `ManifestChangedDuringRunError` already.

Final rule: multi-source acquires locks on each `bodyChildren[i].filePath` and `bibChild.filePath` only. Manifest file is not locked (relies on revision-precondition).

## Tests

`test/markdown-source-lock.test.ts` (new):

1. `runWithLock` acquires + releases sibling `.cite.lock` file. Operation result returned correctly.
2. Two concurrent `runWithLock` calls on the same source serialize: second waits for first.
3. Lock released even if operation throws.
4. Lock timeout: simulate a held lock from another "process" (write a stale lockfile or grab the lock from a separate `proper-lockfile` instance), expect `MarkdownLockTimeoutError`.
5. Stale lock claim: write a lockfile with a dead PID, expect lock acquired.

`test/multi-markdown-source-lock.test.ts` (new) OR extend existing multi-source tests:

1. `runWithLock` acquires locks on every child file + bib file.
2. Locks released in reverse order on operation finish.
3. If acquiring the second child's lock fails, the first child's lock is released.

## Implementation notes

- `proper-lockfile`'s `release` returns a function called to release. Use that pattern; don't try to manage state in the source class beyond pass-through.
- For multi-source: keep a sorted unique list of file paths to lock. Acquire sequentially. Build a release-array as we go, release in reverse. On error, release what we got and rethrow the original acquire error.
- Don't cache lock state between `runWithLock` calls — each call acquires fresh.
- `.gitignore` addition: `*.cite.lock` (project-wide).
