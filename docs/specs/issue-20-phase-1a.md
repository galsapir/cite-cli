# Multi-File Markdown Manifest (#20 Phase 1A) — Spec

## Overview
Manifest infrastructure for multi-file markdown manuscripts. Adds a YAML manifest format and a `MultiMarkdownDocumentSource` that composes N `MarkdownDocumentSource` instances. Phase 1A scope: types, classes, flag wiring, init command. Manifest variants of scan/bib/audit/refresh/remove/insert ship in Phases 2 & 3.

## Goals & Non-Goals

### Goals
- YAML manifest schema (`files:` + `bibliography:`) loaded from any `--manifest <path>`
- `MultiMarkdownDocumentSource` composing N children, with cross-file revision-token semantics
- `--manifest <path>` CLI flag (mutex with `--doc` / `--markdown`) wired via `resolveSource`
- `cite init --manifest <path>` auto-creates an empty manifest when missing
- New `DocSource` variant `markdown-manifest`; state key `mfst_<sha1(realpath(manifestPath))>`
- Agent-recoverable errors: name the offending entry, state the rule, suggest the fix

### Non-Goals
- Multi-file scan/bib/audit/refresh/remove/insert (Phases 2 & 3)
- Globs in `files:` (Phase 4); Quarto/MkDocs interop (Phase 4); `cite migrate-to-manifest` (Phase 4)
- Promoting `revisionToken()` to the `DocumentSource` interface (deferred — only one backend uses composition)

## User Stories
- **Agent driving cite-cli**: I want one artifact listing all manuscript files + bib target, so subsequent commands operate on the whole set without re-passing paths.
- **Agent**: `cite init --manifest manifest.yaml` bootstraps the file when missing, so I don't need a template-generation step.
- **Agent**: When a manifest entry is wrong, the error names the bad entry and tells me the fix, so I can repair without human intervention.

## Technical Design

### Manifest Schema
```yaml
files:
  - 00-abstract.md
  - 01-introduction.md
bibliography: references.md
```
- Both keys required.
- Paths relative to `path.dirname(realpath(manifestPath))`.
- `../` allowed; absolute paths rejected.
- Duplicate entries in `files:` rejected.
- Bib file may or may not appear in `files:`. Either way, bib file is excluded from scan operations.

### Auto-created Manifest (init)
Bare-minimum YAML, no comments (agent-first):
```yaml
files: []
bibliography: references.md
```
`cite scan` on empty `files: []` errors clearly.

### MultiMarkdownDocumentSource
```ts
class MultiMarkdownDocumentSource implements DocumentSource {
  readonly kind = "markdown-manifest" as const;
  readonly manifestPath: string;       // realpath
  readonly manifestDir: string;
  readonly children: MarkdownDocumentSource[];
  readonly bibChild: MarkdownDocumentSource;  // may === one of `children`
}
```
Markdown-only composition. Reaches into concrete child class to call its public `revisionToken()`.

### Cursor Shape — Wrapped
```ts
interface MultiMarkdownCursor {
  fileIdx: number;          // index into `children`
  child: MarkdownCursor;    // forwarded to MarkdownDocumentSource
}
```
Pure composition: child cursor types untouched. Multi-source partitions by `fileIdx` before dispatching writes.

### Revision Tokens
```
token = sha1( childTokens.join("\n") + "\n---\n" + sha1(manifestText) )
```
If any child file OR the manifest text drifts between load and write, abort with `ManifestChangedDuringRunError` naming the offending file (or "manifest itself").

### Cross-File Write Atomicity — Best-effort, fail-fast, no rollback
1. Partition writes per child by `fileIdx`.
2. Each child performs its existing atomic write (`writeFile → tmp → rename`).
3. On first failure, abort. Written files stay written. Remaining files not attempted.
4. Surface: `Wrote N of M files. Failed at: <file>. Re-run; 'cite refresh' reconciles state.`

Matches single-file's "fail loud, don't retry" ethos. No rollback because rollback can itself fail and worsens the error story.

### CLI Flag Wiring
```ts
interface SourceResolveOptions {
  doc?: string;
  markdown?: string;
  manifest?: string;   // new
}
```
Mutex: at most one of `--doc` / `--markdown` / `--manifest`. Precedence: `--manifest` > `--markdown` > `--doc` > config defaults.

### State Keying
```ts
type DocSource =
  | { type: "google-docs"; docId: string }
  | { type: "markdown"; filePath: string }
  | { type: "markdown-manifest"; manifestPath: string };

stateKey = `mfst_${sha1(realpath(manifestPath)).slice(0, 12)}`
```
State key hashes **realpath of the manifest**, NOT contents. Reason: state must be stable across manifest edits (add/remove/reorder); otherwise routine tweaks orphan state. Manifest contents only hash into the revision token.

### Scan Order (Phase 2 implication)
Manifest order, with bib file last regardless of position in `files:`. Bib file excluded from scan entirely.

### Insert Scoping (Phase 3 implication)
Both `--after` and `--paragraph` require explicit `--file <path>`. Trade-off: agent must `grep -n` if it doesn't know which file holds anchor text; safer than first-match-wins ambiguity.

### Init Command
- Manifest file missing → write bare-minimum YAML, then create state record, exit 0.
- Manifest file present, no state record → create state record, idempotent message about manifest, exit 0.
- Manifest file present + state record exists → error (already initialized; suggest `cite audit`), matches existing `cite init --markdown` behavior.
- Manifest file present, malformed → parser-detail error, exit non-zero.
- **Does NOT touch `~/.cite/config.yaml` defaults.** Existing `cite init --markdown` does not set defaults either; setting an active manifest is `cite use`'s job and is **out of Phase 1A scope** (defer to Phase 2 alongside manifest-aware scan/bib).

### Command Guards (Phase 1A)
Phase 1A introduces `markdown-manifest` as a reachable `source.kind`, but no command yet implements manifest-aware logic. Every command that goes through `resolveSource` must reject manifest mode at the top of its action handler:

```ts
// new helper in src/lib/resolve-source.ts
export function rejectManifestSource(resolved: ResolvedSource, commandName: string): void {
  if (resolved.source.kind === "markdown-manifest") {
    process.stderr.write(
      `Error: 'cite ${commandName}' does not yet support --manifest mode (Phase 2/3 of issue #20).\n` +
      `       Manifest: ${resolved.options.manifest ?? "(unknown)"}\n`,
    );
    process.exit(1);
  }
}
```

Commands that need this guard: `scan`, `bib`, `audit`, `refresh`, `remove`, `insert`. Commands that don't currently support markdown either (and thus already fail via `requireGoogleDocsSource`): no change needed beyond updating `requireGoogleDocsSource` itself to also reject `markdown-manifest`.

`cite use` and `cite init` are special: they own the source-kind dispatch directly, no guard needed.

### Dependencies
`yaml` (already in `package.json` v2.8.2 — `import { parse, stringify } from "yaml"`). No new deps.

## Edge Cases & Error Handling

| Case | Behavior |
|---|---|
| Manifest missing on read | `Manifest not found at <abs>. Run 'cite init --manifest <path>'.` |
| Malformed YAML | `Manifest at <path> is not valid YAML: <detail>. Fix the syntax and re-run.` |
| Missing `files:` key | `Manifest at <path> missing required key 'files'.` |
| Missing `bibliography:` key | `Manifest at <path> missing required key 'bibliography'.` |
| `files:` empty | Loads OK. `cite scan` errors: `Manifest <path> has no files listed.` |
| Absolute path in entries | `Manifest entry '<entry>' is absolute; paths must be relative to <manifest dir>.` |
| `../` escape | Allowed. |
| Duplicate entry | `Manifest <path> lists '<entry>' twice. Each file may appear at most once.` |
| Referenced file missing | `Manifest entry '<entry>' resolves to <abs> which does not exist. Create the file or remove the entry.` |
| Bib file missing | OK on read; Phase 2 `cite bib` creates on first write. |
| Manifest text drifts mid-run | `ManifestChangedDuringRunError` naming the manifest. |
| Child file drifts mid-run | `ManifestChangedDuringRunError` naming the drifted file. |
| Partial cross-file write | Abort, report `N of M written, failed at <file>`. |
| Mutex violation | Error names the conflicting flags. |
| `cite init --manifest` on existing valid manifest | Idempotent. |

## Implementation Notes
- `MultiMarkdownDocumentSource` is markdown-only; do NOT widen `DocumentSource` yet.
- Cursors wrapped, not flattened.
- Scan-order + bib-exclusion rules surface in Phase 1A as the body-vs-bib split inside the multi-source.
- TDD: failing tests first per piece (loader, cursor wrapping, revision-token composition, mutex, init wiring, error messages).
- Fixtures under `test/helpers/` per existing convention.

## Open Questions
- `bibChild` exposed as separate property vs. addressed by name during write dispatch — pick what reads cleanest at impl time.
- `bibliography:` required at load time vs. only at first bib-write — conservative pick: require at load. Reverse if init UX suffers.
