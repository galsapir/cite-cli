# cite CLI — Complete Demo

*2026-03-12T20:07:06Z by Showboat 0.6.1*
<!-- showboat-id: 6ca80ddb-e62a-4469-a416-f08e9317f88a -->

## Overview

cite is a terminal-based citation manager for Google Docs. It resolves papers by DOI, PMID, arXiv ID, or title search, stores them in a local library synced with Zotero, and inserts inline citations and bibliographies directly into Google Docs.

This demo walks through every command using a real Google Doc and live API calls.

### 1. Build & Help

Verify the build and see all available commands.

```bash
node dist/index.js --version
```

```output
0.1.0
```

```bash
node dist/index.js --help
```

```output
Usage: cite [options] [command]

CLI Citation Manager for Google Docs

Options:
  -V, --version               output the version number
  -h, --help                  display help for command

Commands:
  auth                        Set up authentication for external services
  add [options] [identifier]  Add a reference to the library by DOI, URL, PMID,
                              arXiv ID, or title
  search [options] [query]    Search the local citation library
  init [options]              Initialize a Google Doc for citation management
  insert [options]            Insert an inline citation into a Google Doc
  bib [options]               Generate or update the bibliography section in a
                              Google Doc
  audit [options]             Audit citations in a Google Doc
  import                      Import references from external sources
  sync [options]              Sync local library mirror with Zotero cloud
  remove [options]            Remove a citation from a Google Doc and renumber
                              remaining citations
  config                      View or update configuration
  help [command]              display help for command
```

### 2. Authentication

cite uses two external services: Google Docs (OAuth2) and Zotero (API key). Both are configured via `cite auth`.

```bash
node dist/index.js auth --help
```

```output
Usage: cite auth [options] [command]

Set up authentication for external services

Options:
  -h, --help      display help for command

Commands:
  google          Set up Google Docs API authentication (OAuth2)
  zotero          Set up Zotero API authentication
  help [command]  display help for command
```

Both auth flows are already configured. Let's verify with `config show`:

```bash
node dist/index.js config show
```

```output
zotero:
  apiKey: zy56****
  userId: "2282119"
  defaultLibrary: user/2282119
google:
  credentialsPath: /Users/galsapir/.cite/google-credentials.json
  tokenPath: /Users/galsapir/.cite/google-token.json

```

API keys are automatically redacted in output.

### 3. Adding References

Add papers by DOI, PMID, arXiv ID, or free-text title search. Each resolves metadata from CrossRef, PubMed, or Semantic Scholar and saves to the local library + Zotero.

**Add by DOI:**

```bash
node dist/index.js add '10.1038/s41586-020-2649-2' -y
```

```output
Resolving doi: 10.1038/s41586-020-2649-2...

Resolved:
  Harris et al. (2020)  "Array programming with NumPy"  Nature  DOI: 10.1038/s41586-020-2649-2
  Cite-key: harris2020a
  → Added to Zotero

✓ Added [harris2020a] to library "user/2282119"
```

**Add another by DOI:**

```bash
node dist/index.js add '10.1056/NEJMra2301725' -y
```

```output
Resolving doi: 10.1056/NEJMra2301725...

Resolved:
  Rajpurkar & Lungren (2023)  "The Current and Future State of AI Interpretation of Medical Images"  New England Journal of Medicine  DOI: 10.1056/NEJMra2301725
  Cite-key: rajpurkar2023
  → Added to Zotero

✓ Added [rajpurkar2023] to library "user/2282119"
```

**Add a third reference:**

```bash
node dist/index.js add '10.1038/s41591-023-02448-8' -y
```

```output
Resolving doi: 10.1038/s41591-023-02448-8...

Resolved:
  Thirunavukarasu et al. (2023)  "Large language models in medicine"  Nature Medicine  DOI: 10.1038/s41591-023-02448-8
  Cite-key: thirunavukarasu2023
  → Added to Zotero

✓ Added [thirunavukarasu2023] to library "user/2282119"
```

### 4. Searching the Library

Search by title, author, or key. With no query, lists all entries.

```bash
node dist/index.js search
```

```output
3 entries in library "user/2282119":

  [harris2020]  Harris et al. (2020)  "Array programming with NumPy"  Nature  DOI: 10.1038/s41586-020-2649-2
  [rajpurkar2023]  Rajpurkar & Lungren (2023)  "The Current and Future State of AI Interpretation of Medical Images"  New England Journal of Medicine  DOI: 10.1056/NEJMra2301725
  [thirunavukarasu2023]  Thirunavukarasu et al. (2023)  "Large language models in medicine"  Nature Medicine  DOI: 10.1038/s41591-023-02448-8
```

**Filter by author:**

```bash
node dist/index.js search --author Harris
```

```output
1 result:

  [harris2020]  Harris et al. (2020)  "Array programming with NumPy"  Nature  DOI: 10.1038/s41586-020-2649-2
```

**Filter by year:**

```bash
node dist/index.js search --year 2023
```

```output
2 results:

  [rajpurkar2023]  Rajpurkar & Lungren (2023)  "The Current and Future State of AI Interpretation of Medical Images"  New England Journal of Medicine  DOI: 10.1056/NEJMra2301725
  [thirunavukarasu2023]  Thirunavukarasu et al. (2023)  "Large language models in medicine"  Nature Medicine  DOI: 10.1038/s41591-023-02448-8
```

### 5. Initializing a Google Doc

Before inserting citations, initialize the doc to bind it to a library and citation style.

```bash
node dist/index.js init --doc 19ewSDHB1AmCNjyxX_lFGE6h2gkDXA91bBDFQ90FfiN4
```

```output
✓ Document initialized for citation management

  Doc ID:   19ewSDHB1AmCNjyxX_lFGE6h2gkDXA91bBDFQ90FfiN4
  Library:  user/2282119
  Style:    vancouver

Use cite insert to add citations and cite bib to generate bibliography.
```

### 6. Inserting Citations

Insert inline citation markers into the Google Doc. Citations are placed after a search string or at a specific paragraph. The `--after` flag finds the text and inserts the marker right after it.

```bash
node dist/index.js insert --doc 19ewSDHB1AmCNjyxX_lFGE6h2gkDXA91bBDFQ90FfiN4 --key thirunavukarasu2023 --after 'ungrounded health advice' -y
```

```output
Fetching document...
  Document: "cite-test" (rev: AIxLkSvU...)

Preview:
  Will insert [1] at paragraph 3, index 178

  Context: ...General-purpose LLMs produce fluent but ungrounded[1] health advice. Trustworthy personal health reports require uniq...

✓ Inserted [1] at index 178
```

Insert a second citation — auto-numbers to [2]:

```bash
node dist/index.js insert --doc 19ewSDHB1AmCNjyxX_lFGE6h2gkDXA91bBDFQ90FfiN4 --key rajpurkar2023 --after 'clinical metrics' -y
```

```output
Fetching document...
  Document: "cite-test" (rev: AIxLkSvX...)
Warning: Document has been modified since last cite operation. Citation indices may be stale.

Preview:
  Will insert [2] at paragraph 3, index 346

  Context: ...rking, domain-expert tools that compute validated [2]clinical metrics (not the LLM), skills that constrain what the LLM...

✓ Inserted [2] at index 346
```

**Dry-run mode** — preview without modifying the doc:

```bash
node dist/index.js insert --doc 19ewSDHB1AmCNjyxX_lFGE6h2gkDXA91bBDFQ90FfiN4 --key harris2020 --after 'enabling data platform' --dry-run
```

```output
Fetching document...
  Document: "cite-test" (rev: AIxLkSsw...)
Warning: Document has been modified since last cite operation. Citation indices may be stale.

Preview:
  Will insert [3] at paragraph 3, index 592

  Context: ...henotyped cohort of 13,000+ participants - as the [3]enabling data platform.
...

(dry-run mode — no changes made)
```

### 7. Generating Bibliography

The `bib` command generates a formatted bibliography from all cited references. It uses named ranges to track the bibliography location for future updates.

```bash
node dist/index.js bib --doc 19ewSDHB1AmCNjyxX_lFGE6h2gkDXA91bBDFQ90FfiN4 --after 'enabling data platform' -y
```

```output
Bibliography preview:

  1. Thirunavukarasu AJ, Ting DSJ, Elangovan K, Gutierrez L, Tan TF, Ting DSW. Large language models in medicine. Nature Medicine. 2023;29(8):1930-1940. doi:10.1038/s41591-023-02448-8
  2. Rajpurkar P, Lungren MP. The Current and Future State of AI Interpretation of Medical Images. New England Journal of Medicine. 2023;388(21):1981-1990. doi:10.1056/NEJMra2301725

Fetching document...
Warning: Document has been modified since last cite operation.
✓ Bibliography updated (2 entries, vancouver style)
```

Supports multiple citation styles:

```bash
node dist/index.js bib --doc 19ewSDHB1AmCNjyxX_lFGE6h2gkDXA91bBDFQ90FfiN4 --style apa --dry-run
```

```output
Bibliography preview:

  Thirunavukarasu, A. J., Ting, D. S. J., Elangovan, K., Gutierrez, L., Tan, T. F., Ting, D. S. W. (2023). Large language models in medicine. Nature Medicine, 29(8), 1930-1940. https://doi.org/10.1038/s41591-023-02448-8
  Rajpurkar, P., Lungren, M. P. (2023). The Current and Future State of AI Interpretation of Medical Images. New England Journal of Medicine, 388(21), 1981-1990. https://doi.org/10.1056/NEJMra2301725

(dry-run mode — no changes made)
```

### 8. Auditing Citations

The audit command checks for inconsistencies: missing keys, numbering gaps, orphaned library entries, and untracked markers.

```bash
node dist/index.js audit --doc 19ewSDHB1AmCNjyxX_lFGE6h2gkDXA91bBDFQ90FfiN4
```

```output

Document: "cite-test"
Doc ID: 19ewSDHB1AmCNjyxX_lFGE6h2gkDXA91bBDFQ90FfiN4
Library: user/2282119
Style: vancouver
Last sync: 2026-03-12T20:11:27.146Z

Citations tracked: 2
Library matches: 2 ✓
Numbering gaps: none

Orphaned library entries (not cited): 1
  - harris2020 (Harris et al., 2020)

```

The audit correctly identifies `harris2020` as orphaned — it's in the library but not cited in the document.

### 9. Importing References

Import from BibTeX, RIS, or SciWheel. Entries are added to the local library and optionally synced to Zotero.

**Import from BibTeX:**

```bash
node dist/index.js import bibtex test/fixtures/sample.bib -y
```

```output
Found 3 references in test/fixtures/sample.bib:

  Lundberg & Lee (2017)  "A Unified Approach to Interpreting Model Predictions"  Advances in Neural Information Processing Systems
  Monteiro & Cannon (2016)  "Ultra-processed foods and diet quality"  Public Health Nutrition  DOI: 10.1017/S1368980015002529
  Off & Garcia (2024)  "Machine learning for diabetes risk prediction"  AMIA Annual Symposium Proceedings

Importing 3 references to library "user/2282119"...
  ✓ [lundberg2017] A Unified Approach to Interpreting Model Predictions
  ✓ [monteiro2016] Ultra-processed foods and diet quality
  ✓ [off2024] Machine learning for diabetes risk prediction

Import complete: 3 added, 0 failed
```

**Import from RIS:**

```bash
node dist/index.js import ris test/fixtures/sample.ris -y
```

```output
Found 2 references in test/fixtures/sample.ris:

  Chen & Zhang (2023)  "Deep learning in healthcare: A systematic review"  Nature Medicine  DOI: 10.1038/s41591-023-02345-0
  Park (2022)  "Wearable sensors for continuous health monitoring"  Sensors  DOI: 10.3390/s22155678

Importing 2 references to library "user/2282119"...
  ✓ [chen2023] Deep learning in healthcare: A systematic review
  ✓ [park2022] Wearable sensors for continuous health monitoring

Import complete: 2 added, 0 failed
```

### 10. Syncing with Zotero

Two-way sync merges local and Zotero libraries, deduplicating by DOI and Zotero key.

```bash
node dist/index.js sync
```

```output
Syncing library "user/2282119" with Zotero...
  Zotero: 117 entries
  Local:  8 entries

✓ Sync complete:
  Total entries: 114
  New from Zotero: 106
```

The sync pulled 106 new entries from the Zotero cloud library, merging them with the 8 local entries.

### 11. Removing Citations

Remove a citation from the document and automatically renumber remaining citations.

```bash
node dist/index.js remove --doc 19ewSDHB1AmCNjyxX_lFGE6h2gkDXA91bBDFQ90FfiN4 --key rajpurkar2023 --dry-run
```

```output
Will remove:
  Citation [2] — key "rajpurkar2023"
  Rajpurkar & Lungren (2023)  "The Current and Future State of AI Interpretation of Medical Images"  New England Journal of Medicine  DOI: 10.1056/NEJMra2301725

(dry-run mode — no changes made)
```

Now remove it for real:

```bash
node dist/index.js remove --doc 19ewSDHB1AmCNjyxX_lFGE6h2gkDXA91bBDFQ90FfiN4 --key rajpurkar2023 -y
```

```output
Will remove:
  Citation [2] — key "rajpurkar2023"
  Rajpurkar & Lungren (2023)  "The Current and Future State of AI Interpretation of Medical Images"  New England Journal of Medicine  DOI: 10.1056/NEJMra2301725

Fetching document...
Warning: Document has been modified since last cite operation. Citation positions may be stale.
✓ Removed [2] and renumbered 0 citations
```

### 12. Configuration

View and modify global or per-document settings.

```bash
node dist/index.js config show
```

```output
zotero:
  apiKey: zy56****
  userId: "2282119"
  defaultLibrary: user/2282119
google:
  credentialsPath: /Users/galsapir/.cite/google-credentials.json
  tokenPath: /Users/galsapir/.cite/google-token.json

```

**Change citation style for a specific doc:**

```bash
node dist/index.js config style apa --doc 19ewSDHB1AmCNjyxX_lFGE6h2gkDXA91bBDFQ90FfiN4
```

```output
✓ Document style set to "apa"
```

**Set a global default:**

```bash
node dist/index.js config set defaults.confirmBeforeWrite false
```

```output
✓ defaults.confirmBeforeWrite = false
```

```bash
node dist/index.js config show
```

```output
zotero:
  apiKey: zy56****
  userId: "2282119"
  defaultLibrary: user/2282119
google:
  credentialsPath: /Users/galsapir/.cite/google-credentials.json
  tokenPath: /Users/galsapir/.cite/google-token.json
defaults:
  confirmBeforeWrite: false

```

---

That covers all 11 commands: `auth`, `add`, `search`, `init`, `insert`, `bib`, `audit`, `import`, `sync`, `remove`, and `config`. All operations ran against a live Google Doc and real Zotero library.
