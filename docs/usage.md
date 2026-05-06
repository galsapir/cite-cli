# Usage Guide

Full command reference for `cite`. Run `cite <command> --help` for option details.

> **Tip:** Set an active source with `cite use --doc <ID>`, `cite use --markdown <PATH>`, or `cite use --manifest <PATH>` and the document-aware commands below will use it by default — no need to pass the source flag every time.

## Backends

`cite` operates on three writing surfaces. Document-aware commands accept one of:

- **`--doc <DOC_ID>`** — a Google Doc. Inline citations are tracked with named ranges + hyperlinks; the bibliography lives in a named range.
- **`--markdown <PATH>`** — a local markdown file. Inline citations are pandoc-style `[@bibkey]` markers; the bibliography lives under a `## References` heading.
- **`--manifest <PATH>`** — a multi-file markdown manuscript. Body files are listed in YAML; the bibliography lives in the configured target file.

`scan`, `bib`, `init`, `use`, `insert`, `audit`, `refresh`, and `remove` support all three surfaces. `--doc`, `--markdown`, and `--manifest` are mutually exclusive on every command.

## Multi-file manifest

A manifest turns several markdown files into one citation source. `cite scan` walks the body files in manifest order, dedupes references against the shared library, and writes each file atomically. See [manifest.md](manifest.md) for the full reference.

Schema:

```yaml
files:
  - 00-abstract.md
  - 01-introduction.md
  - 02-methods.md
  - 03-results.md
  - 04-discussion.md
bibliography: references.md
```

Rules:

- `files:` and `bibliography:` are required.
- Paths resolve relative to the manifest directory.
- `../` is allowed; absolute paths are rejected.
- Duplicate body files are rejected.
- Body files must exist; the bibliography file may not exist until `cite bib` creates it.

Example:

```bash
cite init --manifest cite.manifest.yaml --library group/6466726 --style vancouver
cite sync --library group/6466726 --collection preprint-cits
cite use --manifest cite.manifest.yaml --collection preprint-cits
cite scan
cite bib
cite audit
```

## use

Set or show the active source (Google Doc, markdown file, or manifest) and collection for your working session.

```bash
cite use --doc <DOC_ID> --collection my-paper        # set active Google Doc
cite use --markdown docs/draft.md                    # set active markdown file
cite use --manifest cite.manifest.yaml --collection my-paper  # set active manifest
cite use                                             # show current context
cite use --clear                                     # clear active source + collection
```

Setting one of `--doc`/`--markdown`/`--manifest` clears the others — only one source can be active at a time.

**Options:**

| Flag | Description |
|------|-------------|
| `--doc <id>` | Google Doc ID to work with |
| `--markdown <path>` | Markdown file path to work with |
| `--manifest <path>` | Markdown manifest path to work with |
| `--collection <name>` | Default Zotero collection for new references |
| `--clear` | Clear the active source and collection |

## scan

Scan a Google Doc, markdown file, or manifest for pasted reference URLs and convert them to formatted citations. This is the primary workflow: paste DOI/PubMed/PMC/arXiv/Nature URLs as hyperlinks (or as `[text](url)` markdown links) while writing, then run `cite scan` to process them all.

```bash
cite scan                                # scan active source
cite scan --doc <DOC_ID>                 # explicit Google Doc
cite scan --markdown docs/draft.md       # explicit markdown file
cite scan --manifest cite.manifest.yaml  # explicit manifest
cite scan --dry-run                      # preview without writing
cite scan --collection my-paper          # add new refs to a collection
```

**Detected URL patterns (both backends):**
- `https://doi.org/10.xxx` — DOI
- `https://pubmed.ncbi.nlm.nih.gov/12345` — PubMed
- `https://pmc.ncbi.nlm.nih.gov/articles/PMC12345` — PMC (resolved via PMCID→PMID conversion)
- `https://arxiv.org/abs/2303.08774` — arXiv
- `https://nature.com/articles/s41586-...` — Nature (DOI constructed from URL)
- Any URL containing a DOI pattern

**What it does:**
1. Finds hyperlinks pointing to academic URLs — Google Docs hyperlinks or markdown `[text](url)` links — skipping already-processed citations
2. Resolves each URL to metadata: extracts known identifiers from the URL, scrapes HTML meta tags for DOIs, or falls back to Semantic Scholar title search
3. Adds new references to the library and Zotero collection
4. Replaces each link with a citation marker:
   - **Google Docs**: numeric `[N]` plus a named range and citation hyperlink for durability
   - **Markdown**: pandoc-style `[@bibkey]` (the key is durable across renumbering)
5. **Markdown and manifest only**: writes are atomic (temp + rename) and abort with a clear error if a file changed on disk between load and write — you'll never silently lose edits made in another editor mid-scan

**Options:**

| Flag | Description |
|------|-------------|
| `--doc <id>` | Google Doc ID (uses active source if not specified) |
| `--markdown <path>` | Markdown file path |
| `--manifest <path>` | Markdown manifest path |
| `--collection <name>` | Zotero collection for new references |
| `--dry-run` | Preview without writing |
| `-y, --yes` | Skip confirmation |

## auth

Set up authentication for external services.

```bash
cite auth google    # Google Docs OAuth2 flow
cite auth zotero    # Zotero API key setup
```

## add

Add a reference to the library by DOI, URL, PMID, arXiv ID, or title.

```bash
cite add "10.1038/s41586-020-2649-2"       # DOI
cite add "pmid:29083404"                     # PubMed ID
cite add "arxiv:2303.08774"                  # arXiv ID
cite add "https://pubmed.ncbi.nlm.nih.gov/29083404"  # URL (identifier extracted)
cite add "https://example.com/paper"         # URL (meta tags scraped, then Semantic Scholar fallback)
cite add "Attention is all you need"         # Title search (Semantic Scholar)
```

**Options:**

| Flag | Description |
|------|-------------|
| `--key <key>` | Override the auto-generated cite-key |
| `--file <path>` | Batch add from a file (one identifier per line) |
| `--bibtex <path>` | Import from a BibTeX file |
| `--library <id>` | Target library (overrides default) |
| `--collection <name>` | Zotero collection to add to |
| `-y, --yes` | Skip confirmation prompt |

## search

Search the local citation library.

```bash
cite search                    # List all entries
cite search "machine learning" # Search by title/key/author
cite search --author Harris    # Filter by author
cite search --year 2023        # Filter by year
cite search --tag review       # Filter by tag
```

**Options:**

| Flag | Description |
|------|-------------|
| `--author <name>` | Filter by author name |
| `--year <year>` | Filter by publication year |
| `--tag <tag>` | Filter by tag |
| `--library <id>` | Library to search |

## init

Initialize a document — Google Doc, local markdown file, or manifest — for citation management.

```bash
cite init --doc <DOC_ID>
cite init --doc <DOC_ID> --style apa
cite init --markdown docs/draft.md --library group/12345 --style vancouver
cite init --manifest cite.manifest.yaml --library group/6466726 --style vancouver
```

State is written to `~/.cite/docs/<key>.json`, where `<key>` is the Google Doc ID for `--doc`, `md_<sha1(absolute path)>` for `--markdown`, or `mfst_<sha1(absolute manifest path)>` for `--manifest` — meaning two cwds that point at the same markdown file or manifest resolve to the same state record.

**Options:**

| Flag | Description |
|------|-------------|
| `--doc <id>` | Google Doc ID |
| `--markdown <path>` | Markdown file path |
| `--manifest <path>` | Markdown manifest path |
| `--library <id>` | Library ID (e.g. `group/12345`), defaults to config |
| `--style <style>` | Citation style, defaults to `vancouver` |

`--doc`, `--markdown`, and `--manifest` are mutually exclusive.

## insert

Insert an inline citation into a Google Doc, markdown file, or one body file in a manifest.

```bash
# Insert after specific text
cite insert --key harris2020 --after "some sentence"

# Insert at a specific paragraph
cite insert --key harris2020 --paragraph 5

# Multiple citations at once
cite insert --keys "harris2020,rajpurkar2023" --after "some text"

# Preview only
cite insert --key harris2020 --after "text" --dry-run

# Manifest — scope the anchor to one body file
cite insert --manifest cite.manifest.yaml --file 01-introduction.md --key harris2020 --after "some text"
```

**Options:**

| Flag | Description |
|------|-------------|
| `--doc <id>` | Google Doc ID (uses active doc if not specified) |
| `--markdown <path>` | Markdown file path |
| `--manifest <path>` | Markdown manifest path |
| `--file <path>` | Body file target for `--manifest` inserts |
| `--key <key>` | Single citation key |
| `--keys <keys>` | Comma-separated citation keys |
| `--after <text>` | Insert after first occurrence of this text |
| `--occurrence <n>` | Which occurrence of the search text (default: 1) |
| `--paragraph <n>` | Insert at paragraph number (1-indexed) |
| `--position <pos>` | `start` or `end` within paragraph (default: `end`) |
| `--dry-run` | Preview without writing |
| `-y, --yes` | Skip confirmation |

## bib

Generate or update the bibliography section in a Google Doc, markdown file, or manifest bibliography target.

```bash
# Google Docs — first time, specify where to place it
cite bib --doc <DOC_ID> --after "References"

# Update existing bibliography (either backend)
cite bib

# Markdown — bibliography lands under (or replaces) a `## References` heading
cite bib --markdown docs/draft.md

# Manifest — bibliography lands in the manifest's `bibliography:` file
cite bib --manifest cite.manifest.yaml

# Preview in a different style
cite bib --style apa --dry-run
```

In Google Docs, the bibliography is anchored by a named range and updated in-place on subsequent runs. In markdown, the bibliography lives under a level-2 `## References` heading; re-running `cite bib` rewrites that section in place without disturbing later sections (e.g. `## Appendix`). In manifest mode, the same section is written to the `bibliography:` file. `--after` only applies on first-time placement in Google Docs.

**Options:**

| Flag | Description |
|------|-------------|
| `--doc <id>` | Google Doc ID (uses active source if not specified) |
| `--markdown <path>` | Markdown file path |
| `--manifest <path>` | Markdown manifest path |
| `--style <style>` | Override citation style |
| `--after <text>` | Insert bibliography after this text (Google Docs, first-time only) |
| `--dry-run` | Preview without writing |
| `-y, --yes` | Skip confirmation |

## export

Export a Google Doc tab to a local markdown file (read-only against the source doc). The export preserves headings, bold/italic, links, lists, GitHub-flavoured tables, and fenced code blocks; inline images are extracted to a separate directory; cite-cli citation hyperlinks (`https://cite-cli.local/ref/<key>`) round-trip back to pandoc-style `[@key]` markers so the exported file is immediately operable by `cite scan`/`cite bib`.

```bash
# Default: writes ./doc.md and ./figures/
cite export --doc <DOC_ID>

# Specify output paths and a non-default tab
cite export --doc <DOC_ID> --tab 0 --out docs/draft.md --image-dir docs/figures
```

This is the bridge from a cite-cli'd Google Doc to the markdown workflow: export, then `cite init --markdown <out>` and continue working on the local file.

**Options:**

| Flag | Description |
|------|-------------|
| `--doc <id>` | Google Doc ID (required; or use active doc) |
| `--tab <index>` | Tab index to export (0 = first tab, default) |
| `--out <path>` | Output markdown file (default: `doc.md`) |
| `--image-dir <dir>` | Directory for extracted images (default: `./figures`) |
| `--format <fmt>` | Output format (only `md` supported) |

## audit

Audit citations in a Google Doc, markdown file, or manifest for consistency.

```bash
cite audit
cite audit --manifest cite.manifest.yaml
cite audit --offline    # Audit local state only
```

Reports:
- Missing keys (cited but not in library)
- Numbering gaps
- Orphaned library entries (in library but not cited)
- Untracked markers in the document

**Options:**

| Flag | Description |
|------|-------------|
| `--doc <id>` | Google Doc ID (uses active doc if not specified) |
| `--markdown <path>` | Markdown file path |
| `--manifest <path>` | Markdown manifest path |
| `--offline` | Audit local state only (skip doc fetch) |

## refresh

Repair citations after document reorganization (copy/paste, paragraph moves) across Google Docs, markdown, or manifest sources.

```bash
cite refresh --dry-run   # preview changes
cite refresh             # apply
```

This command:
1. Reads existing citation markers in the active source
2. Reconstructs missing tracking state from durable markers
3. Renumbers Google Docs citations in document order (first-appearance numbering)
4. Rebuilds doc state

**Options:**

| Flag | Description |
|------|-------------|
| `--doc <id>` | Google Doc ID (uses active doc if not specified) |
| `--markdown <path>` | Markdown file path |
| `--manifest <path>` | Markdown manifest path |
| `--dry-run` | Preview without writing |
| `-y, --yes` | Skip confirmation |

**When to use:** After reorganizing a document (moving paragraphs, copy/paste between docs), or when `cite audit` reports numbering gaps or untracked markers.

## import

Import references from external sources.

```bash
cite import bibtex references.bib
cite import ris references.ris
cite import sciwheel --project <ID> --token <TOKEN>
```

See [importing.md](importing.md) for detailed import instructions.

**Subcommands:**

### import bibtex

| Flag | Description |
|------|-------------|
| `<file>` | **(required)** Path to BibTeX file |
| `--library <id>` | Target library |
| `--collection <name>` | Zotero collection to add to |
| `-y, --yes` | Skip confirmation |

### import ris

| Flag | Description |
|------|-------------|
| `<file>` | **(required)** Path to RIS file |
| `--library <id>` | Target library |
| `--collection <name>` | Zotero collection to add to |
| `-y, --yes` | Skip confirmation |

### import sciwheel

| Flag | Description |
|------|-------------|
| `--project <id>` | SciWheel project ID |
| `--token <token>` | SciWheel API bearer token |
| `--library <id>` | Target library |
| `--collection <name>` | Zotero collection to add to |
| `-y, --yes` | Skip confirmation |

## sync

Sync the local library with Zotero cloud.

```bash
cite sync
cite sync --library group/12345
cite sync --collection pha-preprint   # sync only items from this collection
```

Fetches entries from Zotero, merges by DOI and Zotero key, and preserves local-only entries.

**Options:**

| Flag | Description |
|------|-------------|
| `--library <id>` | Library to sync |
| `--collection <name>` | Sync only items from this Zotero collection |

## remove

Remove a citation from a Google Doc, markdown file, or manifest and renumber remaining citations.

```bash
cite remove --key rajpurkar2023
cite remove --manifest cite.manifest.yaml --key rajpurkar2023
cite remove --key rajpurkar2023 --dry-run
```

**Options:**

| Flag | Description |
|------|-------------|
| `--doc <id>` | Google Doc ID (uses active doc if not specified) |
| `--markdown <path>` | Markdown file path |
| `--manifest <path>` | Markdown manifest path |
| `--key <key>` | **(required)** Citation key to remove |
| `--dry-run` | Preview without writing |
| `-y, --yes` | Skip confirmation |

After `cite remove`, run `cite bib` to regenerate the bibliography.

## Configuration reference

`~/.cite/config.yaml` stores credentials, active source defaults, and citation defaults.

```yaml
zotero:
  apiKey: <your-api-key>           # required for Zotero sync; from cite auth zotero
  userId: "<numeric-user-id>"      # your numeric Zotero user ID
  defaultLibrary: <library-id>     # default --library when not specified

google:
  credentialsPath: ~/.cite/google-credentials.json   # set by cite auth google
  tokenPath:       ~/.cite/google-token.json

defaults:
  doc:        <gdoc-id>            # active source via cite use --doc
  markdown:   <abs path>           # active source via cite use --markdown
  manifest:   <abs path>           # active source via cite use --manifest
  collection: <name>               # default Zotero collection for new entries
  style:      vancouver            # default citation style
```

Library ID grammar:

- `local` — local-only library at `~/.cite/libraries/local.json`. Default if you skip `cite auth zotero`.
- `user/<id>` — your personal Zotero library. `<id>` is your numeric Zotero user ID.
- `group/<id>` — a Zotero group library. `<id>` is the numeric group ID.

## config

View and modify configuration.

```bash
cite config show                                      # View config (keys redacted)
cite config style apa                                  # Set global citation style
cite config style vancouver --doc <DOC_ID>             # Set per-doc style
cite config set defaults.confirmBeforeWrite false      # Set any config value
```

**Subcommands:**

### config show

Displays current configuration with API keys redacted.

### config style

| Argument | Description |
|----------|-------------|
| `<style>` | `vancouver`, `apa`, `nature`, `ieee`, or `chicago-author-date` |
| `--doc <id>` | Set style for a specific document only |

### config set

| Argument | Description |
|----------|-------------|
| `<key>` | Dot-notation config key (e.g. `defaults.confirmBeforeWrite`) |
| `<value>` | Value to set (booleans and numbers auto-parsed) |
