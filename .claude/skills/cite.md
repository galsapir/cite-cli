# cite — CLI Citation Manager for Google Docs

You are operating the `cite` CLI, a tool for managing academic citations in Google Docs via the terminal.

## Key Concepts

- **Doc ID**: The long alphanumeric string from a Google Doc URL: `https://docs.google.com/document/d/<DOC_ID>/edit`
- **Cite-key**: Short identifier for a reference (e.g. `harris2020`, `battelino2019`). Auto-generated from first author + year.
- **Library**: Local JSON mirror of references, optionally synced to Zotero. Default library ID comes from config (`zotero.defaultLibrary`) or falls back to `local`.
- **Doc state**: Per-document JSON tracking which citations are inserted, their numbering, and the bibliography named range. Stored at `~/.cite/docs/<DOC_ID>.json`.
- **Active doc/collection**: Set via `cite use` to avoid passing `--doc` on every command.

## Workflow

The primary workflow is: **use → scan → bib**

```bash
# 1. Set up the working session
cite use --doc <DOC_ID> --collection my-paper

# 2. Write in Google Docs, pasting DOI/PubMed/arXiv URLs as hyperlinks

# 3. Process pasted references
cite scan              # finds URLs, resolves, replaces with [1] [2] etc.
cite bib --after "References"   # generate bibliography (first time)
cite bib                        # update bibliography (subsequent)
```

### Manual workflow: **add → init → insert → bib**

```bash
cite add "10.1038/s41586-020-2649-2"          # by DOI
cite init --doc <DOC_ID> --style vancouver
cite insert --key harris2020 --after "some sentence"
cite bib --after "References"
```

## Commands

### cite use
Set or show the active document and collection. All `--doc` flags become optional once set.
```bash
cite use --doc <DOC_ID> --collection my-paper  # set active context
cite use                                        # show current context
cite use --clear                                # clear
```

### cite scan
Scan a Google Doc for pasted academic URLs and convert to citations.
```bash
cite scan                          # scan active doc
cite scan --dry-run                # preview
cite scan --collection my-paper    # add new refs to collection
```
Detects: `doi.org`, `pubmed.ncbi.nlm.nih.gov`, `arxiv.org/abs/`, and URLs with embedded DOIs.

### cite add
Add a reference by DOI, PMID, arXiv ID, URL, or title.
```bash
cite add <identifier> [--key <key>] [--library <id>] [--collection <name>] [-y]
cite add --file dois.txt --collection pha-preprint   # batch add into a collection
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
cite insert --key <key> --after "text to find"
cite insert --keys "key1,key2" --paragraph 5
cite insert --key <key> --after "text" --occurrence 2  # 2nd match
```
Options: `--position start|end`, `--dry-run`, `-y`

### cite bib
Generate or update the bibliography section.
```bash
cite bib --after "References"   # first time
cite bib                         # update existing
cite bib --style apa --dry-run   # preview different style
```

### cite remove
Remove a citation and renumber remaining ones.
```bash
cite remove --key <key> [--dry-run] [-y]
```

### cite refresh
Repair citations after document reorganization (copy/paste, moves).
Reconstructs named ranges from hyperlinks, renumbers in document order.
```bash
cite refresh --dry-run   # preview what will change
cite refresh             # apply repairs
```

### cite audit
Check citation consistency: missing keys, numbering gaps, orphaned entries.
```bash
cite audit
cite audit --offline   # local state only
```

### cite import
Import from BibTeX, RIS, or SciWheel.
```bash
cite import bibtex refs.bib [--library <id>] [--collection <name>] [-y]
cite import ris refs.ris [--library <id>] [--collection <name>] [-y]
cite import sciwheel --project <ID> --token <TOKEN> [--collection <name>]
```

### cite sync
Sync local library with Zotero cloud. Merges by DOI/Zotero key.
```bash
cite sync [--library <id>]
cite sync --collection pha-preprint   # sync only items from this collection
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

1. **Always `--dry-run` first** before any write operation (`insert`, `bib`, `remove`, `scan`). Review the preview before committing.
2. **Always `audit` after changes** to verify consistency.
3. **Never skip confirmation** without previewing via `--dry-run`. Only use `-y` after a successful dry-run of the same command.
4. **Check `search` before `remove`** to verify the citation key exists and confirm you're removing the right one.
5. **Run `bib` after `insert`, `scan`, or `remove`** to keep bibliography in sync.
6. **Revision warnings are important** — if cite warns the document has been modified since the last operation, positions may be stale. Run `audit` first.

## Common Patterns

### Scan-based workflow (primary)
```bash
cite use --doc <DOC_ID> --collection my-paper
# Write in Google Docs, paste reference URLs as hyperlinks
cite scan --dry-run    # preview
cite scan -y           # process
cite bib               # update bibliography
```

### Batch-add papers from a file
```bash
cite add --file papers.txt -y
```

### Re-cite an existing reference
```bash
# If harris2020 is already [1], inserting it again reuses [1]
cite insert --key harris2020 --after "another sentence"
```

### Switch citation style
```bash
cite config style apa
cite bib   # regenerates in new style
```

### Repair after reorganizing a document
```bash
cite refresh --dry-run   # preview changes
cite refresh             # apply
cite bib                 # regenerate bibliography
```

## What NOT to Do

- Never call `insert`, `scan`, or `remove` without `--dry-run` first
- Never call `remove` without checking `audit` or `search` to confirm the key
- Never assume a doc is initialized — check with `audit` or look for errors
- Never pass `-y` on destructive operations (`remove`) without a prior dry-run
- Never ignore revision mismatch warnings
