# Usage Guide

Full command reference for `cite`. Run `cite <command> --help` for option details.

> **Tip:** Set an active source with `cite use --doc <ID>` (or `cite use --markdown <PATH>`) and the document-aware commands below will use it by default — no need to pass `--doc`/`--markdown` every time.

## Backends

`cite` operates on two kinds of documents. Most commands accept either:

- **`--doc <DOC_ID>`** — a Google Doc. Inline citations are tracked with named ranges + hyperlinks; the bibliography lives in a named range.
- **`--markdown <PATH>`** — a local markdown file. Inline citations are pandoc-style `[@bibkey]` markers; the bibliography lives under a `## References` heading.

`scan`, `bib`, `init`, `use` support both. `insert`, `audit`, `refresh`, `remove` are Google-Docs-only today (markdown support tracked in [issue #19](https://github.com/galsapir/cite-cli/issues/19)). `--doc` and `--markdown` are mutually exclusive on every command.

## use

Set or show the active source (Google Doc or markdown file) and collection for your working session.

```bash
cite use --doc <DOC_ID> --collection my-paper        # set active Google Doc
cite use --markdown docs/draft.md                    # set active markdown file
cite use                                             # show current context
cite use --clear                                     # clear active source + collection
```

Setting one of `--doc`/`--markdown` clears the other — only one source can be active at a time.

**Options:**

| Flag | Description |
|------|-------------|
| `--doc <id>` | Google Doc ID to work with |
| `--markdown <path>` | Markdown file path to work with |
| `--collection <name>` | Default Zotero collection for new references |
| `--clear` | Clear the active source and collection |

## scan

Scan a Google Doc or markdown file for pasted reference URLs and convert them to formatted citations. This is the primary workflow: paste DOI/PubMed/PMC/arXiv/Nature URLs as hyperlinks (or as `[text](url)` markdown links) while writing, then run `cite scan` to process them all.

```bash
cite scan                                # scan active source
cite scan --doc <DOC_ID>                 # explicit Google Doc
cite scan --markdown docs/draft.md       # explicit markdown file
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
5. **Markdown only**: writes are atomic (temp + rename) and abort with a clear error if the file changed on disk between load and write — you'll never silently lose edits made in another editor mid-scan

**Options:**

| Flag | Description |
|------|-------------|
| `--doc <id>` | Google Doc ID (uses active source if not specified) |
| `--markdown <path>` | Markdown file path |
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

Initialize a document — Google Doc or local markdown file — for citation management.

```bash
cite init --doc <DOC_ID>
cite init --doc <DOC_ID> --style apa
cite init --markdown docs/draft.md --library group/12345 --style vancouver
```

State is written to `~/.cite/docs/<key>.json`, where `<key>` is the Google Doc ID for `--doc` or `md_<sha1(absolute path)>` for `--markdown` — meaning two cwds that point at the same markdown file resolve to the same state record.

**Options:**

| Flag | Description |
|------|-------------|
| `--doc <id>` | Google Doc ID |
| `--markdown <path>` | Markdown file path |
| `--library <id>` | Library ID (e.g. `group/12345`), defaults to config |
| `--style <style>` | Citation style, defaults to `vancouver` |

`--doc` and `--markdown` are mutually exclusive.

## insert

Insert an inline citation into a Google Doc. Markdown not yet supported (tracked in [issue #19](https://github.com/galsapir/cite-cli/issues/19)).

```bash
# Insert after specific text
cite insert --key harris2020 --after "some sentence"

# Insert at a specific paragraph
cite insert --key harris2020 --paragraph 5

# Multiple citations at once
cite insert --keys "harris2020,rajpurkar2023" --after "some text"

# Preview only
cite insert --key harris2020 --after "text" --dry-run
```

**Options:**

| Flag | Description |
|------|-------------|
| `--doc <id>` | Google Doc ID (uses active doc if not specified) |
| `--key <key>` | Single citation key |
| `--keys <keys>` | Comma-separated citation keys |
| `--after <text>` | Insert after first occurrence of this text |
| `--occurrence <n>` | Which occurrence of the search text (default: 1) |
| `--paragraph <n>` | Insert at paragraph number (1-indexed) |
| `--position <pos>` | `start` or `end` within paragraph (default: `end`) |
| `--dry-run` | Preview without writing |
| `-y, --yes` | Skip confirmation |

## bib

Generate or update the bibliography section in a Google Doc or markdown file.

```bash
# Google Docs — first time, specify where to place it
cite bib --doc <DOC_ID> --after "References"

# Update existing bibliography (either backend)
cite bib

# Markdown — bibliography lands under (or replaces) a `## References` heading
cite bib --markdown docs/draft.md

# Preview in a different style
cite bib --style apa --dry-run
```

In Google Docs, the bibliography is anchored by a named range and updated in-place on subsequent runs. In markdown, the bibliography lives under a level-2 `## References` heading; re-running `cite bib` rewrites that section in place without disturbing later sections (e.g. `## Appendix`). `--after` only applies on first-time placement in Google Docs.

**Options:**

| Flag | Description |
|------|-------------|
| `--doc <id>` | Google Doc ID (uses active source if not specified) |
| `--markdown <path>` | Markdown file path |
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

Audit citations in a Google Doc for consistency. Markdown not yet supported (tracked in [issue #19](https://github.com/galsapir/cite-cli/issues/19)).

```bash
cite audit
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
| `--offline` | Audit local state only (skip doc fetch) |

## refresh

Repair citations after document reorganization (copy/paste, paragraph moves). Google Docs only — markdown tracked in [issue #19](https://github.com/galsapir/cite-cli/issues/19).

```bash
cite refresh --dry-run   # preview changes
cite refresh             # apply
```

This command:
1. Reads all `cite:*` named ranges in the document
2. Scans hyperlinks matching `cite-cli.local/ref/*` for pasted citations that lost their named ranges
3. Reconstructs missing named ranges from hyperlinks
4. Renumbers all citations in document order (first-appearance numbering)
5. Rebuilds doc state

**Options:**

| Flag | Description |
|------|-------------|
| `--doc <id>` | Google Doc ID (uses active doc if not specified) |
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

Remove a citation from a Google Doc and renumber remaining citations. Markdown not yet supported (tracked in [issue #19](https://github.com/galsapir/cite-cli/issues/19)).

```bash
cite remove --key rajpurkar2023
cite remove --key rajpurkar2023 --dry-run
```

**Options:**

| Flag | Description |
|------|-------------|
| `--doc <id>` | Google Doc ID (uses active doc if not specified) |
| `--key <key>` | **(required)** Citation key to remove |
| `--dry-run` | Preview without writing |
| `-y, --yes` | Skip confirmation |

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
