# cite

A terminal-based citation manager for Google Docs and local markdown files.

`cite` resolves papers by DOI, PMID, arXiv ID, or title search, stores them in a local library synced with [Zotero](https://www.zotero.org/), and inserts inline citations and bibliographies directly into either a Google Doc or a markdown file — all from the command line.

## Workflow

The typical workflow: write in Google Docs, paste reference URLs inline, then run `cite scan` to formalize everything.

```bash
# 1. Set up your working session
cite auth zotero && cite auth google         # one-time setup
cite init --doc <DOC_ID> --style vancouver   # initialize a doc
cite use --doc <DOC_ID> --collection my-paper  # set active doc + collection

# 2. Write in Google Docs
#    Paste DOI/PubMed/PMC/arXiv/Nature URLs as hyperlinks while you write

# 3. Process references with one command
cite scan              # finds pasted URLs, resolves them, inserts [1] [2] etc.
cite bib --after "References"   # generate bibliography
```

### Markdown workflow

`scan` and `bib` also work on local markdown files. Inline citations land as pandoc-style `[@bibkey]` markers (durable across renumbering); the bibliography lands under a `## References` heading.

```bash
cite init --markdown docs/whitepaper_draft.md --library group/6466726 --style vancouver
cite scan --markdown docs/whitepaper_draft.md          # converts [Author](DOI) links to [@key]
cite bib  --markdown docs/whitepaper_draft.md          # writes / updates ## References
```

`cite use --markdown <path>` sets the file as the active source so subsequent `scan`/`bib` calls don't need the flag. `insert`, `audit`, `refresh`, and `remove` are not yet markdown-aware — they exit with a clear message pointing at the planned follow-up.

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

| Command | Description |
|---------|-------------|
| `cite use` | Set or show the active document (`--doc` or `--markdown`) and collection |
| `cite scan` | Scan a Google Doc or markdown file for pasted reference URLs and convert to citations |
| `cite add <identifier>` | Add a reference by DOI, PMID, arXiv, URL, or title |
| `cite search [query]` | Search the local library |
| `cite init` | Initialize a Google Doc (`--doc`) or markdown file (`--markdown`) for citations |
| `cite insert` | Insert an inline citation (Google Docs only — markdown planned) |
| `cite bib` | Generate or update bibliography (Google Docs or markdown) |
| `cite export` | Export a Google Doc tab to markdown (read-only, with image extraction) |
| `cite audit` | Audit citations for consistency |
| `cite refresh` | Repair citations after document reorganization |
| `cite remove` | Remove a citation and renumber |
| `cite import bibtex <file>` | Import from BibTeX |
| `cite import ris <file>` | Import from RIS |
| `cite sync` | Sync local library with Zotero |
| `cite config show` | View configuration |
| `cite auth google/zotero` | Set up authentication |

All commands that operate on a document accept `--doc <id>` or `--markdown <path>` (where supported), but if you've set an active source with `cite use`, the flag is optional.

See [docs/usage.md](docs/usage.md) for full command reference.

## Features

- **Scan & cite** — paste DOI/PubMed/PMC/arXiv/Nature URLs in your doc, run `cite scan` to convert them all to formatted citations
- **Named ranges + hyperlinks** — citations survive document reorganization and copy/paste
- **Zotero collections** — organize references into collections per paper
- **Multiple citation styles** — Vancouver (default), APA, Nature, IEEE, Chicago
- **Import** — BibTeX, RIS, or SciWheel
- **Audit & refresh** — detect inconsistencies and repair citations after edits

## Documentation

- [Getting Started](docs/getting-started.md) — First-time setup from scratch
- [Usage Guide](docs/usage.md) — Full command reference with examples
- [Importing References](docs/importing.md) — BibTeX, RIS, and SciWheel import guide

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

Each Google Doc is bound to a library and citation style via `cite init`. Inline citations are tracked using Google Docs named ranges and hyperlinks for durability. The bibliography is managed through a named range for reliable in-place updates.

## License

MIT
