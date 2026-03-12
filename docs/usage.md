# Usage Guide

Full command reference for `cite`. Run `cite <command> --help` for option details.

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
cite add "https://example.com/paper"         # URL
cite add "Attention is all you need"         # Title search (Semantic Scholar)
```

**Options:**

| Flag | Description |
|------|-------------|
| `--key <key>` | Override the auto-generated cite-key |
| `--file <path>` | Batch add from a file (one identifier per line) |
| `--bibtex <path>` | Import from a BibTeX file |
| `--library <id>` | Target library (overrides default) |
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
| `--doc <id>` | **(required)** Google Doc ID |
| `--library <id>` | Library ID (e.g. `group/12345`), defaults to config |
| `--style <style>` | Citation style, defaults to `vancouver` |

## insert

Insert an inline citation into a Google Doc.

```bash
# Insert after specific text
cite insert --doc <DOC_ID> --key harris2020 --after "some sentence"

# Insert at a specific paragraph
cite insert --doc <DOC_ID> --key harris2020 --paragraph 5

# Multiple citations at once
cite insert --doc <DOC_ID> --keys "harris2020,rajpurkar2023" --after "some text"

# Preview only
cite insert --doc <DOC_ID> --key harris2020 --after "text" --dry-run
```

**Options:**

| Flag | Description |
|------|-------------|
| `--doc <id>` | **(required)** Google Doc ID |
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
cite bib --doc <DOC_ID> --after "References"

# Update existing bibliography
cite bib --doc <DOC_ID>

# Preview in a different style
cite bib --doc <DOC_ID> --style apa --dry-run
```

**Options:**

| Flag | Description |
|------|-------------|
| `--doc <id>` | **(required)** Google Doc ID |
| `--style <style>` | Override citation style |
| `--after <text>` | Insert bibliography after this text (first-time only) |
| `--dry-run` | Preview without writing |
| `-y, --yes` | Skip confirmation |

## audit

Audit citations in a Google Doc for consistency.

```bash
cite audit --doc <DOC_ID>
cite audit --doc <DOC_ID> --offline    # Audit local state only
```

Reports:
- Missing keys (cited but not in library)
- Numbering gaps
- Orphaned library entries (in library but not cited)
- Untracked markers in the document

**Options:**

| Flag | Description |
|------|-------------|
| `--doc <id>` | **(required)** Google Doc ID |
| `--offline` | Audit local state only (skip doc fetch) |

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
| `-y, --yes` | Skip confirmation |

### import ris

| Flag | Description |
|------|-------------|
| `<file>` | **(required)** Path to RIS file |
| `--library <id>` | Target library |
| `-y, --yes` | Skip confirmation |

### import sciwheel

| Flag | Description |
|------|-------------|
| `--project <id>` | SciWheel project ID |
| `--token <token>` | SciWheel API bearer token |
| `--library <id>` | Target library |
| `-y, --yes` | Skip confirmation |

## sync

Sync the local library with Zotero cloud.

```bash
cite sync
cite sync --library group/12345
```

Fetches entries from Zotero, merges by DOI and Zotero key, and preserves local-only entries.

**Options:**

| Flag | Description |
|------|-------------|
| `--library <id>` | Library to sync |

## remove

Remove a citation from a Google Doc and renumber remaining citations.

```bash
cite remove --doc <DOC_ID> --key rajpurkar2023
cite remove --doc <DOC_ID> --key rajpurkar2023 --dry-run
```

**Options:**

| Flag | Description |
|------|-------------|
| `--doc <id>` | **(required)** Google Doc ID |
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
