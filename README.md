# cite

A terminal-based citation manager for Google Docs.

`cite` resolves papers by DOI, PMID, arXiv ID, or title search, stores them in a local library synced with [Zotero](https://www.zotero.org/), and inserts inline citations and bibliographies directly into Google Docs — all from the command line.

## Features

- **Add references** by DOI, PMID, arXiv ID, URL, or free-text title search
- **Insert inline citations** into Google Docs with automatic numbering
- **Generate bibliographies** in Vancouver, APA, Nature, IEEE, or Chicago style
- **Import** from BibTeX, RIS, or SciWheel
- **Sync** your local library with Zotero cloud
- **Audit** citations for consistency (missing keys, numbering gaps, orphaned entries)
- **Remove** citations with automatic renumbering

## Quick Start

```bash
# Install dependencies and build
npm install && npm run build

# Set up Zotero and Google Docs authentication
cite auth zotero
cite auth google

# Add a paper by DOI
cite add "10.1038/s41586-020-2649-2"

# Initialize a Google Doc
cite init --doc <GOOGLE_DOC_ID>

# Insert a citation
cite insert --doc <DOC_ID> --key harris2020 --after "some text in your doc"

# Generate bibliography
cite bib --doc <DOC_ID> --after "References"
```

## Prerequisites

- Node.js 18+
- A [Zotero](https://www.zotero.org/) account with an API key
- A Google Cloud project with the Google Docs API enabled

See [docs/getting-started.md](docs/getting-started.md) for detailed setup instructions.

## Commands

| Command | Description |
|---------|-------------|
| `cite auth google` | Set up Google Docs OAuth2 |
| `cite auth zotero` | Set up Zotero API key |
| `cite add <identifier>` | Add a reference by DOI, PMID, arXiv, URL, or title |
| `cite search [query]` | Search the local library |
| `cite init --doc <id>` | Initialize a Google Doc for citations |
| `cite insert --doc <id>` | Insert an inline citation |
| `cite bib --doc <id>` | Generate or update bibliography |
| `cite audit --doc <id>` | Audit citations for consistency |
| `cite import bibtex <file>` | Import from BibTeX |
| `cite import ris <file>` | Import from RIS |
| `cite import sciwheel` | Import from SciWheel |
| `cite sync` | Sync local library with Zotero |
| `cite remove --doc <id>` | Remove a citation and renumber |
| `cite config show` | View configuration |
| `cite config style <style>` | Set citation style |

See [docs/usage.md](docs/usage.md) for full command reference.

## Documentation

- [Getting Started](docs/getting-started.md) — First-time setup from scratch
- [Usage Guide](docs/usage.md) — Full command reference with examples
- [Importing References](docs/importing.md) — BibTeX, RIS, and SciWheel import guide

## Citation Styles

- **Vancouver** (default) — numbered, used in biomedical journals
- **APA** — author-date, used in social sciences
- **Nature** — numbered, used by Nature journals
- **IEEE** — numbered, used in engineering
- **Chicago (author-date)** — used in humanities

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

Each Google Doc is bound to a library and citation style via `cite init`. Citations are tracked with indices and positions, and the bibliography is managed through named ranges for reliable updates.

## License

MIT
