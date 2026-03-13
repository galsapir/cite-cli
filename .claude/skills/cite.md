# cite — CLI Citation Manager for Google Docs

You are operating the `cite` CLI, a tool for managing academic citations in Google Docs via the terminal.

## Key Concepts

- **Doc ID**: The long alphanumeric string from a Google Doc URL: `https://docs.google.com/document/d/<DOC_ID>/edit`
- **Cite-key**: Short identifier for a reference (e.g. `harris2020`, `battelino2019`). Auto-generated from first author + year.
- **Library**: Local JSON mirror of references, optionally synced to Zotero. Default library ID comes from config (`zotero.defaultLibrary`) or falls back to `local`.
- **Doc state**: Per-document JSON tracking which citations are inserted, their numbering, and the bibliography named range. Stored at `~/.cite/docs/<DOC_ID>.json`.

## Workflow

The standard workflow is: **add → init → insert → bib**

```bash
# 1. Add references to the library
cite add "10.1038/s41586-020-2649-2"          # by DOI
cite add "pmid:29083404"                       # by PubMed ID
cite add "Attention is all you need"           # by title search

# 2. Initialize a Google Doc
cite init --doc <DOC_ID> --style vancouver

# 3. Insert inline citations
cite insert --doc <DOC_ID> --key harris2020 --after "some sentence"
cite insert --doc <DOC_ID> --keys "harris2020,smith2021" --after "other text"

# 4. Generate bibliography
cite bib --doc <DOC_ID> --after "References"   # first time: place after heading
cite bib --doc <DOC_ID>                         # subsequent: updates in-place
```

## Commands

### cite add
Add a reference by DOI, PMID, arXiv ID, URL, or title.
```bash
cite add <identifier> [--key <key>] [--library <id>] [-y]
cite add --file dois.txt          # batch add, one ID per line
```

### cite search
Search the local library.
```bash
cite search                        # list all
cite search "query"                # free-text search
cite search --author Harris --year 2023
```

### cite init
Initialize a doc for citations. Must be done before insert/bib/audit.
```bash
cite init --doc <DOC_ID> [--style <style>] [--library <id>]
```
Styles: `vancouver` (default), `apa`, `nature`, `ieee`, `chicago-author-date`

### cite insert
Insert an inline citation marker into the document.
```bash
cite insert --doc <DOC_ID> --key <key> --after "text to find"
cite insert --doc <DOC_ID> --keys "key1,key2" --paragraph 5
cite insert --doc <DOC_ID> --key <key> --after "text" --occurrence 2  # 2nd match
```
Options: `--position start|end`, `--dry-run`, `-y`

### cite bib
Generate or update the bibliography section.
```bash
cite bib --doc <DOC_ID> --after "References"   # first time
cite bib --doc <DOC_ID>                         # update existing
cite bib --doc <DOC_ID> --style apa --dry-run   # preview different style
```

### cite remove
Remove a citation and renumber remaining ones.
```bash
cite remove --doc <DOC_ID> --key <key> [--dry-run] [-y]
```

### cite audit
Check citation consistency: missing keys, numbering gaps, orphaned entries.
```bash
cite audit --doc <DOC_ID>
cite audit --doc <DOC_ID> --offline   # local state only
```

### cite import
Import from BibTeX, RIS, or SciWheel.
```bash
cite import bibtex refs.bib [--library <id>] [-y]
cite import ris refs.ris [--library <id>] [-y]
cite import sciwheel --project <ID> --token <TOKEN>
```

### cite sync
Sync local library with Zotero cloud. Merges by DOI/Zotero key.
```bash
cite sync [--library <id>]
```

### cite config
View or modify configuration.
```bash
cite config show                                     # view (keys redacted)
cite config style apa                                # global default
cite config style vancouver --doc <DOC_ID>           # per-doc
cite config set defaults.confirmBeforeWrite false     # any config key
```

### cite auth
Set up service authentication.
```bash
cite auth google    # OAuth2 flow for Google Docs
cite auth zotero    # Zotero API key + user ID
```

## Safety Rules

1. **Always `--dry-run` first** before any write operation (`insert`, `bib`, `remove`). Review the preview before committing.
2. **Always `audit` after changes** to verify consistency.
3. **Never skip confirmation** without previewing via `--dry-run`. Only use `-y` after a successful dry-run of the same command.
4. **Check `search` before `remove`** to verify the citation key exists and confirm you're removing the right one.
5. **Run `bib` after `insert` or `remove`** to keep bibliography in sync.
6. **Revision warnings are important** — if cite warns the document has been modified since the last operation, positions may be stale. Run `audit` first.

## Common Patterns

### Batch-add papers from a file
```bash
# Create a file with one identifier per line (DOIs, PMIDs, etc.)
cite add --file papers.txt -y
```

### Re-cite an existing reference
```bash
# If harris2020 is already [1], inserting it again reuses [1]
cite insert --doc <DOC_ID> --key harris2020 --after "another sentence"
```

### Switch citation style
```bash
cite config style apa --doc <DOC_ID>
cite bib --doc <DOC_ID>   # regenerates in new style
```

### Full audit after reorganizing a document
```bash
cite audit --doc <DOC_ID>
# Review output for untracked markers, gaps, or missing keys
```

## What NOT to Do

- Never call `insert` or `remove` without `--dry-run` first
- Never call `remove` without checking `audit` or `search` to confirm the key
- Never assume a doc is initialized — check with `audit` or look for errors
- Never pass `-y` on destructive operations (`remove`) without a prior dry-run
- Never ignore revision mismatch warnings
