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
| `cite remove` | Removes `[@key]` from all body files and the bibliography file, then renumbers state | `--manifest <path>`, `--key <key>`, `--dry-run` |
| `cite insert` | Inserts into one body file scoped by `--file`; the bibliography file is not a valid target | `--manifest <path>`, `--file <path>`, `--key <key>` or `--keys <keys>`, `--after <text>` or `--paragraph <n>` |

`cite insert --manifest` requires `--file <path>` so an anchor match is scoped to exactly one body file.

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
