# Usage Guide

Full command reference for `cite`. Run `cite <command> --help` for option details.

> **Tip:** Set an active document with `cite use --doc <ID>` and all commands below will use it by default — no need to pass `--doc` every time.

## use

Set or show the active document and collection for your working session.

```bash
cite use --doc <DOC_ID> --collection my-paper   # set active context
cite use                                         # show current context
cite use --clear                                 # clear active context
```

**Options:**

| Flag | Description |
|------|-------------|
| `--doc <id>` | Google Doc ID to work with |
| `--collection <name>` | Default Zotero collection for new references |
| `--clear` | Clear the active doc and collection |

## scan

Scan a Google Doc for pasted reference URLs and convert them to formatted citations. This is the primary workflow: paste DOI/PubMed/PMC/arXiv/Nature URLs as hyperlinks while writing, then run `cite scan` to process them all.

```bash
cite scan                          # scan active doc
cite scan --doc <DOC_ID>           # explicit doc
cite scan --dry-run                # preview without writing
cite scan --collection my-paper    # add new refs to a collection
```

**Detected URL patterns:**
- `https://doi.org/10.xxx` — DOI
- `https://pubmed.ncbi.nlm.nih.gov/12345` — PubMed
- `https://pmc.ncbi.nlm.nih.gov/articles/PMC12345` — PMC (resolved via PMCID→PMID conversion)
- `https://arxiv.org/abs/2303.08774` — arXiv
- `https://nature.com/articles/s41586-...` — Nature (DOI constructed from URL)
- Any URL containing a DOI pattern

**What it does:**
1. Finds hyperlinks pointing to academic URLs (skips already-processed citations)
2. Resolves each URL to metadata — extracts known identifiers from the URL, scrapes HTML meta tags for DOIs, or falls back to Semantic Scholar title search
3. Adds new references to the library and Zotero collection
4. Replaces each hyperlink with a formatted citation marker (e.g., `[1]`)
5. Adds named ranges and citation hyperlinks for durability

**Options:**

| Flag | Description |
|------|-------------|
| `--doc <id>` | Google Doc ID (uses active doc if not specified) |
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

Initialize a Google Doc for citation management.

```bash
cite init --doc <DOC_ID>
cite init --doc <DOC_ID> --style apa
cite init --doc <DOC_ID> --library group/12345
```

**Options:**

| Flag | Description |
|------|-------------|
| `--doc <id>` | Google Doc ID (uses active doc if not specified) |
| `--library <id>` | Library ID (e.g. `group/12345`), defaults to config |
| `--style <style>` | Citation style, defaults to `vancouver` |

## insert

Insert an inline citation into a Google Doc.

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

Generate or update the bibliography section in a Google Doc.

```bash
# First time — specify where to place it
cite bib --after "References"

# Update existing bibliography
cite bib

# Preview in a different style
cite bib --style apa --dry-run
```

**Options:**

| Flag | Description |
|------|-------------|
| `--doc <id>` | Google Doc ID (uses active doc if not specified) |
| `--style <style>` | Override citation style |
| `--after <text>` | Insert bibliography after this text (first-time only) |
| `--dry-run` | Preview without writing |
| `-y, --yes` | Skip confirmation |

## audit

Audit citations in a Google Doc for consistency.

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

Repair citations after document reorganization (copy/paste, paragraph moves).

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

Remove a citation from a Google Doc and renumber remaining citations.

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
