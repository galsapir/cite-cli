# Multi-file markdown manifest

A manifest is a small YAML file that tells `cite` which markdown files make up one manuscript and where the bibliography belongs. Use it when a paper is split across chapters, sections, or generated manuscript fragments. One command walks the body files in manifest order, dedupes references across the shared library, and writes each affected file atomically.

## Manifest schema

```yaml
files:
  - <relative-body-file.md>
  - <another-relative-body-file.md>
bibliography: <relative-bibliography-file.md>
```

Required keys:

| Key | Type | Meaning |
|-----|------|---------|
| `files` | list of relative paths | Body markdown files to scan, audit, refresh, remove from, or insert into |
| `bibliography` | relative path | Bibliography target; may be outside `files:` |

Path rules:

- Paths resolve relative to the manifest directory.
- `../` is allowed.
- Absolute paths are rejected.
- Duplicate body files are rejected.
- Body files must exist before commands run.
- The bibliography file may not exist; `cite bib` creates it on first run.

Example:

```yaml
files:
  - 00-abstract.md
  - 01-introduction.md
  - 02-methods.md
  - 03-results.md
  - 04-discussion.md
bibliography: references.md
```

## Terminology

- **Occurrence** — one `[@key]` marker in a body file. Two `[@battelino2019]` in the same file are two occurrences. Four occurrences across a manifest of three files is also fine.
- **Citation** — a unique cite-key tracked in the per-document state (`~/.cite/docs/<state-key>.json` under `citations[]`). One entry per key, regardless of how many occurrences. The `namedRangeIds` field on a citation lists per-occurrence handles using the `${fileIdx}:${childHandle}` namespace.
- **Library entry** — a unique reference in the local library mirror (`~/.cite/libraries/<library-id>.json`). Shared across documents; two documents citing the same DOI both see one library entry.
- **Cite-key** — the human-readable identifier used in `[@key]` markers and as the join key between citations and library entries.

A manifest of 3 body files where one DOI appears in files 1 and 3 yields **2 occurrences, 1 citation, 1 library entry**.

## Workflow

This example uses the maintainer's pha-preprint Zotero group library. Replace `group/6466726` and `preprint-cits` with your own library and collection.

```bash
cite init --manifest cite.manifest.yaml --library group/6466726 --style vancouver
cite sync --library group/6466726 --collection preprint-cits
cite use --manifest cite.manifest.yaml --collection preprint-cits
cite scan
cite bib
cite audit
```

Approximate output:

```text
Manifest initialized: cite.manifest.yaml
Synced group/6466726 collection preprint-cits
Active source: cite.manifest.yaml
Scanned 5 files
Converted 2 links to citations
  01-introduction.md: Khasentino et al. → [@khasentino2025]
  02-methods.md: Health-LLM → [@kim2024]
Wrote 2 files
Updated bibliography: references.md
Audit passed: 2 citations, 2 library entries, 0 untracked markers
```

Draft body files with normal markdown links:

```markdown
Khasentino et al. reported PHA-related findings [Khasentino](https://doi.org/10.1038/s41591-025-03888-0).

Health-LLM is available on arXiv [Health-LLM](https://arxiv.org/abs/2401.06866).
```

After `cite scan`:

```markdown
Khasentino et al. reported PHA-related findings [@khasentino2025].

Health-LLM is available on arXiv [@kim2024].
```

## Command matrix

| Command | Manifest behavior | Special flags |
|---------|-------------------|---------------|
| `cite scan` | Walks body files in manifest order, resolves academic links, inserts `[@bibkey]` markers, skips the bibliography file | `--manifest <path>`, `--collection <name>`, `--dry-run` |
| `cite bib` | Reads citations across body files and writes/updates the bibliography target | `--manifest <path>`, `--style <style>`, `--dry-run` |
| `cite audit` | Compares state, body markers, and library entries; reports file names for untracked markers | `--manifest <path>`, `--offline` |
| `cite refresh` | Rebuilds citation state from body files in manifest order after copy/paste or file reorganization | `--manifest <path>`, `--dry-run` |
| `cite remove` | Deletes every occurrence of `[@key]` from all body files and the bibliography file, then renumbers state | `--manifest <path>`, `--key <key>`, `--dry-run` |
| `cite insert` | Inserts into one body file scoped by `--file`; the bibliography file is not a valid target | `--manifest <path>`, `--file <path>`, `--key <key>` or `--keys <keys>`, `--after <text>` or `--paragraph <n>` |

**Note:** `cite remove --key X` deletes every occurrence of `[@X]` across all body files AND the bibliography file in one operation. There is no occurrence-scoped variant — if you want to remove just the citation you just inserted, ensure the key has no other occurrences in the manuscript first (use `cite search <query>` and inspect body files), or pick a key that isn't already cited.

`cite insert --manifest` requires `--file <path>` so an anchor match is scoped to exactly one body file.

Find valid cite-keys with `cite search --library <library-id>` (lists every entry) or `cite search <query>` (filters by author/title/key).

## How dedup works across files

`cite scan` extracts canonical identifiers before writing. If the same DOI appears in multiple body files, the first occurrence resolves the reference and later occurrences reuse the same cite-key.

Example:

```markdown
# 01-introduction.md
Khasentino appears here [Khasentino](https://doi.org/10.1038/s41591-025-03888-0).

# 03-results.md
The same study appears again [Khasentino](https://doi.org/10.1038/s41591-025-03888-0).
```

After `cite scan`:

```markdown
# 01-introduction.md
Khasentino appears here [@khasentino2025].

# 03-results.md
The same study appears again [@khasentino2025].
```

Two markers, one library entry.

## Concurrent edits + lock files

`cite` acquires a per-file `<file>.cite.lock` around the load→write window. Two concurrent `cite` runs on the same manifest serialize instead of racing. Lock staleness follows `proper-lockfile` semantics: a stale claim expires and can be acquired by the next run.

If any body file, bibliography file, or the manifest itself changes between load and write, the run aborts instead of overwriting edits made elsewhere.

## Common gotchas

- Manifest file must contain BOTH `files:` and `bibliography:`. An empty file or comment-only file fails init with a parser error.
- Body files in `files:` must exist on disk. The bibliography file may not exist — `cite bib` creates it on first run.
- After `cite remove`, the bibliography in the file is NOT updated automatically. Re-run `cite bib` to regenerate.
- `cite insert --manifest` requires `--file <path>` matching one of the body files. The bibliography file is not a valid `--file` target.
- Concurrent `cite` runs on the same manifest serialize via the per-file lock. If a previous run crashed, the lock self-cleans after 30s of staleness; manual cleanup: remove `<file>.cite.lock`.

## Library setup with a Zotero group

Find the group ID in the Zotero web UI: open the group page and read the numeric ID from `zotero.org/groups/<id>/...`.

Or list groups via the Zotero API:

```bash
# Replace <YOUR_API_KEY> and <YOUR_USER_ID> from ~/.cite/config.yaml.
curl -s -H "Zotero-API-Key: <YOUR_API_KEY>" \
  "https://api.zotero.org/users/<YOUR_USER_ID>/groups" | jq '.[].data | {id, name}'
```

Use the ID as `group/<id>`:

```bash
cite init --manifest cite.manifest.yaml --library group/<id> --style vancouver
cite sync --library group/<id> --collection <collection-name>
```

## Configuration

See [usage.md](usage.md#configuration-reference) for the full `~/.cite/config.yaml` schema.
