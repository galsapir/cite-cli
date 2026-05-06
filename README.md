# cite

A markdown-first terminal citation manager. Drop reference URLs into your manuscript, run `cite scan`, and let pandoc-style `[@bibkey]` markers + a generated `## References` section appear. Your library lives in [Zotero](https://www.zotero.org/) for portability and team sharing.

`cite` works across three writing surfaces:

- **Multi-file markdown manifest** — `cite.manifest.yaml` lists the body files (chapters, sections) plus a bibliography target. One scan walks all of them, dedupes references against the shared library, writes per-file atomic edits. **The default for academic manuscripts.**
- **Single-file markdown** — same workflow on one file. Use it when the manuscript fits in one document.
- **Google Docs** — for collaborative drafting with comment threads / suggestion mode. Citations are tracked via named ranges; the same `scan` / `bib` commands apply. Use this when you need real-time co-editing.

`cite export` migrates a Google Doc tab into the markdown workflow when you're ready to switch.

## Quickstart (multi-file manifest)

```bash
# 1. One-time setup — Zotero API key + Google OAuth (only if you'll use --doc)
cite auth zotero
cite auth google   # optional, only for Google Docs

# 2. Initialize a manifest (pha-preprint group from this README's examples;
#    replace with your own group/<id> or use --library local).
cite init --manifest cite.manifest.yaml --library group/6466726 --style vancouver

# 3. Mirror Zotero → local cache so scan can dedupe against existing items.
cite sync --library group/6466726 --collection preprint-cits

# 4. Set as active source so the rest of the commands don't need --manifest.
cite use --manifest cite.manifest.yaml --collection preprint-cits

# 5. Write — in any of the body files listed under `files:`, paste reference
#    URLs as `[Author](URL)` markdown links. Then:
cite scan          # walks all body files, inserts [@bibkey] markers
cite bib           # writes/updates ## References in the bibliography file
```

`cite scan` resolves DOI / PubMed / PMC / arXiv / Nature URLs against your Zotero library and falls back to network resolution for new entries. `cite use` makes the manifest the active source — subsequent commands work without `--manifest`. See [docs/manifest.md](docs/manifest.md) for the full manifest reference.

### Single-file markdown

Same workflow on one file. Inline citations land as pandoc `[@bibkey]` markers; the bibliography lands under `## References`.

```bash
cite init --markdown docs/whitepaper_draft.md --library group/6466726 --style vancouver
cite use  --markdown docs/whitepaper_draft.md
cite scan
cite bib
```

`scan`, `bib`, `audit`, `refresh`, `remove`, and `insert` all work against single-file markdown. (`insert` requires `--key` plus an anchor like `--after "some text"` or `--paragraph N`.)

### Google Docs (collaborative drafting)

Use `--doc <DOC_ID>` when you need real-time co-editing or suggestion mode. The same `scan` / `bib` / `audit` / `refresh` / `remove` / `insert` commands apply.

```bash
cite init --doc <DOC_ID> --library group/6466726 --style vancouver
cite use  --doc <DOC_ID> --collection my-paper
cite scan
cite bib --after "References"
```

`cite export --doc <DOC_ID> --tab 0 --out docs/draft.md` migrates a Google Doc into the markdown workflow when you no longer need real-time collaboration.

### Exporting a Google Doc to markdown

`cite export` reads tab-N of a Google Doc and writes it out as markdown, extracting any inline images:

```bash
cite export --doc <DOC_ID> --tab 0 --out docs/draft.md --image-dir docs/figures
```

Headings, bold/italic, links, lists, GitHub-flavoured tables, and fenced code blocks are preserved. Read-only against the source doc.

### Manual citation flow

For more control, add and insert references individually:

```bash
cite add "10.1038/s41586-020-2649-2"         # add by DOI
cite add "Attention is all you need"          # add by title search
cite insert --key harris2020 --after "some text"   # insert citation
cite bib                                      # update bibliography
```

## Prerequisites

- Node.js 18+
- A [Zotero](https://www.zotero.org/) account with an API key
- A Google Cloud project with the Google Docs API enabled

See [docs/getting-started.md](docs/getting-started.md) for detailed setup instructions.

## Install

```bash
npm install && npm run build
```

## Commands

| Command | Surfaces | Description |
|---------|----------|-------------|
| `cite use` | all | Set/show active source (`--doc`, `--markdown`, `--manifest`) and collection |
| `cite init` | all | Initialize a Google Doc (`--doc`), markdown file (`--markdown`), or manifest (`--manifest`) |
| `cite scan` | all | Scan for pasted reference URLs and convert to inline citations |
| `cite bib` | all | Generate or update the bibliography section |
| `cite audit` | all | Audit citations for consistency (state ↔ document body) |
| `cite refresh` | all | Repair citations after document reorganization |
| `cite remove` | all | Remove a citation across all surfaces |
| `cite insert` | all | Insert an inline citation (`--manifest` requires `--file <path>`) |
| `cite add <identifier>` | — | Add a reference by DOI, PMID, arXiv, URL, or title |
| `cite search [query]` | — | Search the local library |
| `cite sync` | — | Sync local library mirror with Zotero |
| `cite import bibtex/ris <file>` | — | Import references from external sources |
| `cite export` | gdocs → md | Export a Google Doc tab to markdown (read-only) |
| `cite config show` | — | View configuration |
| `cite auth google/zotero` | — | Set up authentication |

"Surfaces" = which writing surface(s) the command supports. "all" = Google Docs + single-file markdown + multi-file manifest.

See [docs/usage.md](docs/usage.md) for full command reference.

## Features

- **Scan & cite** — paste DOI/PubMed/PMC/arXiv/Nature URLs in your doc, run `cite scan` to convert them all to formatted citations
- **Three surfaces, one workflow** — operate on multi-file manifests (`--manifest`), local markdown files (`--markdown`), or Google Docs (`--doc`); same commands, same library
- **Multi-file manuscripts** — `cite.manifest.yaml` lists body files + bibliography; `cite scan` walks all of them, dedupes references, writes per-file atomic edits. See [docs/manifest.md](docs/manifest.md).
- **Durable citation markers** — Google Docs uses named ranges + hyperlinks; markdown uses pandoc `[@bibkey]` keys. Both survive document reorganization and copy/paste
- **Safe markdown writes** — atomic temp-file + rename, plus a revision-precondition check that aborts (rather than overwriting) if the file changed on disk between read and write
- **Zotero collections** — organize references into collections per paper
- **Multiple citation styles** — Vancouver (default), APA, Nature, IEEE, Chicago
- **Import** — BibTeX, RIS, or SciWheel
- **Audit & refresh** — detect inconsistencies and repair citations after edits

## Documentation

- [Getting Started](docs/getting-started.md) — First-time setup from scratch
- [Usage Guide](docs/usage.md) — Full command reference with examples
- [Importing References](docs/importing.md) — BibTeX, RIS, and SciWheel import guide
- [Manifest Reference](docs/manifest.md) — schema, command matrix, and worked example for multi-file markdown manuscripts
- [`docs/specs/`](docs/specs/) — developer-facing design specs (issue history, decisions). Most users don't need these.

## How It Works

cite stores data in `~/.cite/`:

```
~/.cite/
├── config.yaml              # Global configuration
├── google-credentials.json  # Google OAuth client credentials
├── google-token.json        # Google OAuth token
├── libraries/               # Local citation libraries (JSON)
├── docs/                    # Per-document state (citations, style)
└── logs/                    # Operation logs
```

Each source — Google Doc, markdown file, or manifest — is bound to a library and citation style via `cite init`.

- **Google Docs**: state is keyed by the document ID. Inline citations are tracked using named ranges and hyperlinks; the bibliography lives in a named range for reliable in-place updates.
- **Markdown**: state is keyed by `md_<sha1(absolute path)>`, so two working directories that point at the same file resolve to the same state record. Inline citations are pandoc `[@bibkey]` markers; the bibliography lives under a `## References` heading. Writes go through a temp-file + rename and abort if the file changed on disk since `cite` started reading it.
- **Multi-file manifest**: state is keyed by `mfst_<sha1(absolute manifest path)>`. The `MultiMarkdownDocumentSource` composes one `MarkdownDocumentSource` per body file (plus the bibliography file). Cross-file occurrence handles are namespaced as `${fileIdx}:${childHandle}`. Per-file revision-precondition checks abort the whole run if any file drifted between load and write.

## License

MIT
