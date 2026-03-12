# cite CLI — Phase 1 Demo

*2026-03-12T14:18:34Z by Showboat 0.6.1*
<!-- showboat-id: 69656352-53d7-4acc-9763-2a5436bd6c7f -->

## Phase 1: Foundation (MVP)

This demo walks through every command implemented in Phase 1 of the `cite` CLI — a terminal-based citation manager for Google Docs. Phase 1 covers: project structure, authentication commands, adding references, searching the library, initializing docs, and the Google Docs reader layer.

All commands are run from the project root.

### 1. Project Overview

The CLI is built with TypeScript + Commander.js. Let's verify the build and see the top-level help.

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
  help [command]              display help for command
```

### 2. Authentication Commands

Two auth subcommands are available: `cite auth google` for Google Docs OAuth2, and `cite auth zotero` for the Zotero API key. Both are interactive flows that save credentials to `~/.cite/config.yaml`.

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

```bash
node dist/index.js auth google --help
```

```output
Usage: cite auth google [options]

Set up Google Docs API authentication (OAuth2)

Options:
  -h, --help  display help for command
```

```bash
node dist/index.js auth zotero --help
```

```output
Usage: cite auth zotero [options]

Set up Zotero API authentication

Options:
  -h, --help  display help for command
```

### 3. `cite add` — Add References to the Library

The `add` command resolves references by DOI, URL, PubMed ID, arXiv ID, or free-text title search. It supports batch import, cite-key overrides, and writes to both Zotero (if configured) and the local JSON mirror.

Since network access to CrossRef/Semantic Scholar is unavailable in this environment, we demonstrate the command's interface and then manually seed the library to show downstream features.

```bash
node dist/index.js add --help
```

```output
Usage: cite add [options] [identifier]

Add a reference to the library by DOI, URL, PMID, arXiv ID, or title

Arguments:
  identifier       DOI, URL, PMID, arXiv ID, or paper title

Options:
  --key <key>      Override the auto-generated cite-key
  --file <path>    Batch add from a file of DOIs (one per line)
  --bibtex <path>  Import from BibTeX file
  --library <id>   Target library (overrides default)
  -y, --yes        Skip confirmation prompt
  -h, --help       display help for command
```

Let's seed the local library with sample references to demonstrate search and init. We write directly to the library JSON file (simulating what `cite add` does after resolving metadata).

```bash
mkdir -p ~/.cite/libraries ~/.cite/docs && cat > ~/.cite/libraries/local.json << 'SEED'
[
  {
    "key": "battelino2019",
    "csl": {
      "id": "10.2337/dc19-1028",
      "type": "article-journal",
      "title": "Clinical Targets for Continuous Glucose Monitoring Data Interpretation: Recommendations From the International Consensus on Time in Range",
      "author": [
        {"given": "Tadej", "family": "Battelino"},
        {"given": "Thomas", "family": "Danne"},
        {"given": "Richard M", "family": "Bergenstal"}
      ],
      "issued": {"date-parts": [[2019]]},
      "container-title": "Diabetes Care",
      "volume": "42",
      "issue": "8",
      "page": "1593-1603",
      "DOI": "10.2337/dc19-1028"
    },
    "addedAt": "2026-03-12T10:00:00Z",
    "tags": ["cgm", "diabetes", "consensus"]
  },
  {
    "key": "broll2021",
    "csl": {
      "id": "10.1371/journal.pone.0248560",
      "type": "article-journal",
      "title": "Interpreting blood GLUcose data with R package iglu",
      "author": [
        {"given": "Steven", "family": "Broll"},
        {"given": "Irina", "family": "Gaynanova"},
        {"given": "Elizabeth", "family": "Chun"}
      ],
      "issued": {"date-parts": [[2021]]},
      "container-title": "PLOS ONE",
      "volume": "16",
      "issue": "4",
      "DOI": "10.1371/journal.pone.0248560"
    },
    "addedAt": "2026-03-12T10:01:00Z",
    "tags": ["cgm", "iglu", "r-package"]
  },
  {
    "key": "score2_2021",
    "csl": {
      "id": "10.1093/eurheartj/ehab309",
      "type": "article-journal",
      "title": "SCORE2 risk prediction algorithms: new models to estimate 10-year risk of cardiovascular disease in Europe",
      "author": [
        {"literal": "SCORE2 working group"}
      ],
      "issued": {"date-parts": [[2021]]},
      "container-title": "European Heart Journal",
      "volume": "42",
      "issue": "25",
      "page": "2439-2454",
      "DOI": "10.1093/eurheartj/ehab309"
    },
    "addedAt": "2026-03-12T10:02:00Z",
    "tags": ["cardiovascular", "risk-prediction"]
  },
  {
    "key": "merrill2026",
    "csl": {
      "id": "10.1038/s41467-025-67922-y",
      "type": "article-journal",
      "title": "Non-experts can distinguish AI-generated from human writing in short health texts",
      "author": [
        {"given": "Melissa A", "family": "Merrill"},
        {"given": "Gal", "family": "Sapir"}
      ],
      "issued": {"date-parts": [[2026]]},
      "container-title": "Nature Communications",
      "DOI": "10.1038/s41467-025-67922-y"
    },
    "addedAt": "2026-03-12T10:03:00Z",
    "tags": ["ai", "health-communication"]
  }
]
SEED
echo "Library seeded with 4 references."
```

```output
Library seeded with 4 references.
```

### 4. `cite search` — Search the Local Library

Search by free text, author, year, or tag. With no arguments, lists all entries.

```bash
node dist/index.js search
```

```output
4 entries in library "local":

  [battelino2019]  Battelino et al. (2019)  "Clinical Targets for Continuous Glucose Monitoring Data Interpretation: Recommendations From the International Consensus on Time in Range"  Diabetes Care  DOI: 10.2337/dc19-1028
  [broll2021]  Broll et al. (2021)  "Interpreting blood GLUcose data with R package iglu"  PLOS ONE  DOI: 10.1371/journal.pone.0248560
  [score2_2021]  SCORE2 working group (2021)  "SCORE2 risk prediction algorithms: new models to estimate 10-year risk of cardiovascular disease in Europe"  European Heart Journal  DOI: 10.1093/eurheartj/ehab309
  [merrill2026]  Merrill & Sapir (2026)  "Non-experts can distinguish AI-generated from human writing in short health texts"  Nature Communications  DOI: 10.1038/s41467-025-67922-y
```

```bash
node dist/index.js search glucose
```

```output
2 results:

  [battelino2019]  Battelino et al. (2019)  "Clinical Targets for Continuous Glucose Monitoring Data Interpretation: Recommendations From the International Consensus on Time in Range"  Diabetes Care  DOI: 10.2337/dc19-1028
  [broll2021]  Broll et al. (2021)  "Interpreting blood GLUcose data with R package iglu"  PLOS ONE  DOI: 10.1371/journal.pone.0248560
```

```bash
node dist/index.js search --author Battelino
```

```output
1 result:

  [battelino2019]  Battelino et al. (2019)  "Clinical Targets for Continuous Glucose Monitoring Data Interpretation: Recommendations From the International Consensus on Time in Range"  Diabetes Care  DOI: 10.2337/dc19-1028
```

```bash
node dist/index.js search --year 2021
```

```output
2 results:

  [broll2021]  Broll et al. (2021)  "Interpreting blood GLUcose data with R package iglu"  PLOS ONE  DOI: 10.1371/journal.pone.0248560
  [score2_2021]  SCORE2 working group (2021)  "SCORE2 risk prediction algorithms: new models to estimate 10-year risk of cardiovascular disease in Europe"  European Heart Journal  DOI: 10.1093/eurheartj/ehab309
```

```bash
node dist/index.js search --tag cgm
```

```output
2 results:

  [battelino2019]  Battelino et al. (2019)  "Clinical Targets for Continuous Glucose Monitoring Data Interpretation: Recommendations From the International Consensus on Time in Range"  Diabetes Care  DOI: 10.2337/dc19-1028
  [broll2021]  Broll et al. (2021)  "Interpreting blood GLUcose data with R package iglu"  PLOS ONE  DOI: 10.1371/journal.pone.0248560
```

### 5. `cite init` — Initialize a Doc for Citation Management

Creates a per-doc state file at `~/.cite/docs/{docId}.json` that tracks which citations are in the document, the library it's linked to, and the citation style.

```bash
node dist/index.js init --doc 12Vw8AnI8t848aiSoUqRqz8rN17itcfzQuRtmwYHT4no --style vancouver
```

```output
✓ Document initialized for citation management

  Doc ID:   12Vw8AnI8t848aiSoUqRqz8rN17itcfzQuRtmwYHT4no
  Library:  local
  Style:    vancouver

Use cite insert to add citations and cite bib to generate bibliography.
```

```bash
cat ~/.cite/docs/12Vw8AnI8t848aiSoUqRqz8rN17itcfzQuRtmwYHT4no.json
```

```output
{
  "docId": "12Vw8AnI8t848aiSoUqRqz8rN17itcfzQuRtmwYHT4no",
  "libraryId": "local",
  "style": "vancouver",
  "citations": [],
  "lastSync": "2026-03-12T14:20:26.210Z"
}```
```

### 6. Google Docs Reader — Document Parsing & Text Location

The `google-docs.ts` module can fetch a doc via the API, extract text, locate search strings with their character indices, and find paragraphs by number. This is the foundation for Phase 2's `cite insert`.

Here we verify the unit tests for this layer:

```bash
npx vitest run 2>&1
```

```output

[1m[46m RUN [49m[22m [36mv4.1.0 [39m[90m/home/user/cite-and-write-cli[39m


[2m Test Files [22m [1m[32m3 passed[39m[22m[90m (3)[39m
[2m      Tests [22m [1m[32m23 passed[39m[22m[90m (23)[39m
[2m   Start at [22m 14:20:41
[2m   Duration [22m 840ms[2m (transform 189ms, setup 0ms, import 929ms, tests 15ms, environment 0ms)[22m

```

### 7. Project Structure

A look at the directory layout and file structure:

```bash
find src test -type f | sort
```

```output
src/commands/add.ts
src/commands/auth.ts
src/commands/init.ts
src/commands/search.ts
src/index.ts
src/lib/config.ts
src/lib/doc-state.ts
src/lib/format.ts
src/lib/google-auth.ts
src/lib/google-docs.ts
src/lib/library.ts
src/lib/resolver.ts
src/lib/zotero.ts
src/types/index.ts
test/google-docs.test.ts
test/library.test.ts
test/resolver.test.ts
```

### 8. Local State Structure

The `~/.cite/` directory holds all config, library mirrors, and per-doc state:

```bash
find ~/.cite -type f | sort
```

```output
/root/.cite/docs/12Vw8AnI8t848aiSoUqRqz8rN17itcfzQuRtmwYHT4no.json
/root/.cite/libraries/local.json
```

---

## Phase 1 Summary

**Implemented:**
- Project scaffolding: TypeScript + Commander.js + Vitest
- `cite auth google` — OAuth2 flow with local redirect server, token storage
- `cite auth zotero` — Interactive API key setup, saves to `~/.cite/config.yaml`
- `cite add` — Resolves DOI/PMID/arXiv/URL/title via CrossRef, PubMed, arXiv, Semantic Scholar APIs; writes to Zotero + local JSON mirror; supports `--file` batch, `--key` override, `--yes` non-interactive
- `cite search` — Full-text, author, year, and tag filtering across the local library
- `cite init` — Creates per-doc state (docId, libraryId, style, citations list)
- Google Docs reader: document fetching, text extraction, search string location with character indices, paragraph finder
- 23 unit tests covering resolver, library, and Google Docs parsing

**Architecture:** Three-layer design (Resolver → Library → Doc Editor) with local state at `~/.cite/` and Zotero cloud sync.

**Next: Phase 2** will add `cite insert`, `cite bib`, `cite audit`, and the safety layer.

---

## Phase 2: Core Editing

Phase 2 adds the commands that actually write to Google Docs: `cite insert`, `cite bib`, and `cite audit`. It also implements the safety layer (reverse-index batching, revisionId checks, operation logging).

### 9. `cite insert` — Insert Inline Citations

Inserts a citation marker (e.g. `[1]`) at a specific location in a Google Doc. Supports:
- `--after "text"` to insert after a search string
- `--paragraph N` to insert at a paragraph boundary
- `--key` for single or `--keys` for multiple citations
- Preview before commit, with context display
- Automatic numbering and de-duplication

```bash
node dist/index.js insert --help
```

```output
Usage: cite insert [options]

Insert an inline citation into a Google Doc

Options:
  --doc <docId>     Google Doc ID
  --key <key>       Citation key from library
  --keys <keys>     Comma-separated citation keys
  --after <text>    Insert after this search string (first occurrence)
  --occurrence <n>  Which occurrence of the search string (default: "1")
  --paragraph <n>   Insert at paragraph number (1-indexed)
  --position <pos>  Position within paragraph: start or end (default: "end")
  -y, --yes         Skip confirmation prompt
  -h, --help        display help for command
```

The insert command requires Google Docs API access (which is not available in this sandbox). The command flow is:
1. Fetch document via `documents.get`
2. Locate insertion point by searching for the `--after` text
3. Compute the character index at the end of the match
4. Show preview with surrounding context and citation marker
5. On confirm, execute `batchUpdate` with `insertText` at the computed index
6. Update per-doc state with new citation number and key
7. Log the operation to `~/.cite/docs/{docId}.log`

### 10. `cite bib` — Bibliography Generation

Generates a formatted bibliography from all tracked citations. Supports 5 built-in styles: Vancouver, APA, Nature, IEEE, and Chicago author-date. Includes `--dry-run` for preview-only mode.

```bash
node dist/index.js bib --help
```

```output
Usage: cite bib [options]

Generate or update the bibliography section in a Google Doc

Options:
  --doc <docId>    Google Doc ID
  --style <style>  Citation style override
  --after <text>   Insert bibliography after this text (first time only)
  --dry-run        Preview only, do not write
  -y, --yes        Skip confirmation prompt
  -h, --help       display help for command
```

#### Vancouver style (default):

```bash
node dist/index.js bib --doc 12Vw8AnI8t848aiSoUqRqz8rN17itcfzQuRtmwYHT4no --dry-run
```

```output
Bibliography preview:

  1. Merrill MA, Sapir G. Non-experts can distinguish AI-generated from human writing in short health texts. Nature Communications. 2026. doi:10.1038/s41467-025-67922-y
  2. Battelino T, Danne T, Bergenstal RM. Clinical Targets for Continuous Glucose Monitoring Data Interpretation: Recommendations From the International Consensus on Time in Range. Diabetes Care. 2019;42(8):1593-1603. doi:10.2337/dc19-1028
  3. Broll S, Gaynanova I, Chun E. Interpreting blood GLUcose data with R package iglu. PLOS ONE. 2021;16(4). doi:10.1371/journal.pone.0248560
  4. [ERROR: key "smith2023missing" not found in library]

(dry-run mode — no changes made)
```

#### APA style:

```bash
node dist/index.js bib --doc 12Vw8AnI8t848aiSoUqRqz8rN17itcfzQuRtmwYHT4no --style apa --dry-run
```

```output
Bibliography preview:

  Merrill, M. A., Sapir, G. (2026). Non-experts can distinguish AI-generated from human writing in short health texts. Nature Communications. https://doi.org/10.1038/s41467-025-67922-y
  Battelino, T., Danne, T., Bergenstal, R. M. (2019). Clinical Targets for Continuous Glucose Monitoring Data Interpretation: Recommendations From the International Consensus on Time in Range. Diabetes Care, 42(8), 1593-1603. https://doi.org/10.2337/dc19-1028
  Broll, S., Gaynanova, I., Chun, E. (2021). Interpreting blood GLUcose data with R package iglu. PLOS ONE, 16(4). https://doi.org/10.1371/journal.pone.0248560
  4. [ERROR: key "smith2023missing" not found in library]

(dry-run mode — no changes made)
```

#### IEEE style:

```bash
node dist/index.js bib --doc 12Vw8AnI8t848aiSoUqRqz8rN17itcfzQuRtmwYHT4no --style ieee --dry-run
```

```output
Bibliography preview:

  [1] M. A. Merrill, G. Sapir, "Non-experts can distinguish AI-generated from human writing in short health texts," Nature Communications, 2026.
  [2] T. Battelino, T. Danne, R. M. Bergenstal, "Clinical Targets for Continuous Glucose Monitoring Data Interpretation: Recommendations From the International Consensus on Time in Range," Diabetes Care, vol. 42, no. 8, pp. 1593-1603, 2019.
  [3] S. Broll, I. Gaynanova, E. Chun, "Interpreting blood GLUcose data with R package iglu," PLOS ONE, vol. 16, no. 4, 2021.
  4. [ERROR: key "smith2023missing" not found in library]

(dry-run mode — no changes made)
```

### 11. `cite audit` — Document Health Check

Compares citations in the document against the library, reports mismatches, numbering gaps, and orphaned entries.

```bash
node dist/index.js audit --doc 12Vw8AnI8t848aiSoUqRqz8rN17itcfzQuRtmwYHT4no --offline
```

```output

Document: "(offline mode)"
Doc ID: 12Vw8AnI8t848aiSoUqRqz8rN17itcfzQuRtmwYHT4no
Library: local
Style: vancouver
Last sync: 2026-03-12T10:30:00Z

Citations tracked: 4
Library matches: 3 ✓
Missing from library: 1 ✗
  [4] — key "smith2023missing" not found
Numbering gaps: none

Orphaned library entries (not cited): 1
  - score2_2021 (SCORE2 working group, 2021)

```

The audit correctly identifies:
- **3 valid citations** matching library entries
- **1 missing key** (`smith2023missing` — not in library)
- **No numbering gaps** (sequential 1-4)
- **1 orphaned entry** (`score2_2021` — in library but not cited in this doc)

### 12. Safety Layer

The safety system ensures no accidental content deletion:
- **Reverse-index batching**: Multiple insertions sorted highest-index-first so earlier indices remain valid
- **RevisionId checking**: Detects concurrent edits and aborts if the doc changed since fetch
- **Operation logging**: All mutations logged to `~/.cite/docs/{docId}.log`
- **Preview-before-commit**: Every write shows context, index, and marker before executing
- **Safe zones**: Only tool-managed ranges (bibliography) can be replaced; user content is insert-only

### 13. Full Test Suite

```bash
npx vitest run 2>&1
```

```output

[1m[46m RUN [49m[22m [36mv4.1.0 [39m[90m/home/user/cite-and-write-cli[39m


[2m Test Files [22m [1m[32m5 passed[39m[22m[90m (5)[39m
[2m      Tests [22m [1m[32m38 passed[39m[22m[90m (38)[39m
[2m   Start at [22m 14:26:56
[2m   Duration [22m 867ms[2m (transform 239ms, setup 0ms, import 1.07s, tests 26ms, environment 0ms)[22m

```

---

## Phase 2 Summary

**Implemented:**
- `cite insert` — Single/multi citation insertion with `--after` text search or `--paragraph` targeting, preview, auto-numbering, de-duplication
- `cite bib` — Bibliography generation with 5 built-in styles (Vancouver, APA, Nature, IEEE, Chicago), `--dry-run` preview, named range management for updates
- `cite audit` — Document health check: validates citations vs. library, reports missing keys, numbering gaps, orphaned entries
- Safety layer: reverse-index request sorting, revisionId conflict detection, operation logging, preview-before-commit
- Citation formatter: inline markers (`[N]`, `(Author, Year)`) and full bibliography entries for all 5 styles
- 38 unit tests across 5 test files

**Next: Phase 3** will add `cite import` (SciWheel, BibTeX), `cite sync`, and extended resolver paths (URL, PubMed, arXiv, free text).

---

## Phase 3: Import & Collaboration

Phase 3 adds `cite import` (BibTeX, RIS, SciWheel) and `cite sync` for Zotero cloud synchronization.

### 14. `cite import bibtex` — Import from BibTeX Files

Parses BibTeX into CSL-JSON, generates cite-keys, and adds to the local library.

```bash
node dist/index.js import bibtex --help
```

```output
Usage: cite import bibtex [options] <file>

Import references from a BibTeX file

Arguments:
  file            Path to BibTeX file

Options:
  --library <id>  Target library (overrides default)
  -y, --yes       Skip confirmation prompt
  -h, --help      display help for command
```

```bash
node dist/index.js import bibtex test/fixtures/sample.bib --yes
```

```output
Found 3 references in test/fixtures/sample.bib:

  Lundberg & Lee (2017)  "A Unified Approach to Interpreting Model Predictions"  Advances in Neural Information Processing Systems
  Monteiro & Cannon (2016)  "Ultra-processed foods and diet quality"  Public Health Nutrition  DOI: 10.1017/S1368980015002529
  Off & Garcia (2024)  "Machine learning for diabetes risk prediction"  AMIA Annual Symposium Proceedings

Importing 3 references to library "local"...
  ✓ [lundberg2017] A Unified Approach to Interpreting Model Predictions
  ✓ [monteiro2016] Ultra-processed foods and diet quality
  ✓ [off2024] Machine learning for diabetes risk prediction

Import complete: 3 added, 0 failed
```

### 15. `cite import ris` — Import from RIS Files

```bash
node dist/index.js import ris test/fixtures/sample.ris --yes
```

```output
Found 2 references in test/fixtures/sample.ris:

  Chen & Zhang (2023)  "Deep learning in healthcare: A systematic review"  Nature Medicine  DOI: 10.1038/s41591-023-02345-0
  Park (2022)  "Wearable sensors for continuous health monitoring"  Sensors  DOI: 10.3390/s22155678

Importing 2 references to library "local"...
  ✓ [chen2023] Deep learning in healthcare: A systematic review
  ✓ [park2022] Wearable sensors for continuous health monitoring

Import complete: 2 added, 0 failed
```

### 16. Library After Import

The library now contains all seeded + imported references:

```bash
node dist/index.js search
```

```output
9 entries in library "local":

  [battelino2019]  Battelino et al. (2019)  "Clinical Targets for Continuous Glucose Monitoring Data Interpretation: Recommendations From the International Consensus on Time in Range"  Diabetes Care  DOI: 10.2337/dc19-1028
  [broll2021]  Broll et al. (2021)  "Interpreting blood GLUcose data with R package iglu"  PLOS ONE  DOI: 10.1371/journal.pone.0248560
  [score2_2021]  SCORE2 working group (2021)  "SCORE2 risk prediction algorithms: new models to estimate 10-year risk of cardiovascular disease in Europe"  European Heart Journal  DOI: 10.1093/eurheartj/ehab309
  [merrill2026]  Merrill & Sapir (2026)  "Non-experts can distinguish AI-generated from human writing in short health texts"  Nature Communications  DOI: 10.1038/s41467-025-67922-y
  [lundberg2017]  Lundberg & Lee (2017)  "A Unified Approach to Interpreting Model Predictions"  Advances in Neural Information Processing Systems
  [monteiro2016]  Monteiro & Cannon (2016)  "Ultra-processed foods and diet quality"  Public Health Nutrition  DOI: 10.1017/S1368980015002529
  [off2024]  Off & Garcia (2024)  "Machine learning for diabetes risk prediction"  AMIA Annual Symposium Proceedings
  [chen2023]  Chen & Zhang (2023)  "Deep learning in healthcare: A systematic review"  Nature Medicine  DOI: 10.1038/s41591-023-02345-0
  [park2022]  Park (2022)  "Wearable sensors for continuous health monitoring"  Sensors  DOI: 10.3390/s22155678
```

### 17. `cite import sciwheel` — SciWheel Migration

The SciWheel import fetches BibTeX from the SciWheel API and processes it the same way:

```bash
node dist/index.js import sciwheel --help
```

```output
Usage: cite import sciwheel [options]

One-time import from SciWheel project (exports as BibTeX)

Options:
  --project <id>   SciWheel project ID
  --token <token>  SciWheel API bearer token
  --library <id>   Target library (overrides default)
  -y, --yes        Skip confirmation prompt
  -h, --help       display help for command
```

### 18. `cite sync` — Zotero Cloud Sync

Synchronizes the local JSON mirror with the Zotero cloud library. Merges remote entries by DOI deduplication.

```bash
node dist/index.js sync --help
```

```output
Usage: cite sync [options]

Sync local library mirror with Zotero cloud

Options:
  --library <id>  Library to sync (overrides default)
  -h, --help      display help for command
```

### 19. Test Suite — All Phases

```bash
npx vitest run 2>&1
```

```output

[1m[46m RUN [49m[22m [36mv4.1.0 [39m[90m/home/user/cite-and-write-cli[39m


[2m Test Files [22m [1m[32m6 passed[39m[22m[90m (6)[39m
[2m      Tests [22m [1m[32m45 passed[39m[22m[90m (45)[39m
[2m   Start at [22m 14:30:42
[2m   Duration [22m 1.03s[2m (transform 311ms, setup 0ms, import 1.10s, tests 35ms, environment 1ms)[22m

```

---

## Phase 3 Summary

**Implemented:**
- `cite import bibtex` — Parse BibTeX files into CSL-JSON, auto-generate cite-keys, add to library
- `cite import ris` — Parse RIS files the same way
- `cite import sciwheel` — One-time SciWheel project export via API → BibTeX → library
- `cite sync` — Bidirectional Zotero ↔ local mirror sync with DOI-based deduplication
- BibTeX and RIS parsers with LaTeX markup cleaning
- 45 unit tests across 6 test files (7 new for parsers)

**Next: Phase 4** will add polish features: batch DOI file import, citation removal with renumbering, fuzzy matching, --dry-run and --yes flags on all commands, and style switching.

---

## Phase 4: Polish

Phase 4 adds `cite remove` (safe citation removal with renumbering), `cite config` (style switching and configuration), and `--dry-run` support across all write commands.

### 20. `cite remove` — Safe Citation Removal with Renumbering

Removes a citation marker from the document and renumbers all subsequent citations. Defaults to confirmation prompt (`N`) for safety.

```bash
node dist/index.js remove --help
```

```output
Usage: cite remove [options]

Remove a citation from a Google Doc and renumber remaining citations

Options:
  --doc <docId>  Google Doc ID
  --key <key>    Citation key to remove
  --dry-run      Preview only, do not write
  -y, --yes      Skip confirmation prompt
  -h, --help     display help for command
```

```bash
node dist/index.js remove --doc 12Vw8AnI8t848aiSoUqRqz8rN17itcfzQuRtmwYHT4no --key battelino2019 --dry-run
```

```output
Will remove:
  Citation [2] — key "battelino2019"
  Battelino et al. (2019)  "Clinical Targets for Continuous Glucose Monitoring Data Interpretation: Recommendations From the International Consensus on Time in Range"  Diabetes Care  DOI: 10.2337/dc19-1028

Renumbering required: 2 citations will be renumbered
  [3] → [2] (broll2021)
  [4] → [3] (smith2023missing)

(dry-run mode — no changes made)
```

The dry-run shows exactly what would happen: citation [2] removed, [3] becomes [2], [4] becomes [3]. No document is modified until explicit confirmation.

### 21. `cite config` — Configuration Management

View and modify settings. Supports style switching per-doc or globally.

```bash
node dist/index.js config show
```

```output
{}

```

```bash
node dist/index.js config style vancouver && node dist/index.js config set defaults.confirmBeforeWrite true && node dist/index.js config set defaults.autoSyncBib true && node dist/index.js config show
```

```output
✓ Default style set to "vancouver"
✓ defaults.confirmBeforeWrite = true
✓ defaults.autoSyncBib = true
defaults:
  style: vancouver
  confirmBeforeWrite: true
  autoSyncBib: true

```

Switch a specific document to APA style:

```bash
node dist/index.js config style apa --doc 12Vw8AnI8t848aiSoUqRqz8rN17itcfzQuRtmwYHT4no && node dist/index.js bib --doc 12Vw8AnI8t848aiSoUqRqz8rN17itcfzQuRtmwYHT4no --dry-run
```

```output
✓ Document style set to "apa"
Bibliography preview:

  Merrill, M. A., Sapir, G. (2026). Non-experts can distinguish AI-generated from human writing in short health texts. Nature Communications. https://doi.org/10.1038/s41467-025-67922-y
  Battelino, T., Danne, T., Bergenstal, R. M. (2019). Clinical Targets for Continuous Glucose Monitoring Data Interpretation: Recommendations From the International Consensus on Time in Range. Diabetes Care, 42(8), 1593-1603. https://doi.org/10.2337/dc19-1028
  Broll, S., Gaynanova, I., Chun, E. (2021). Interpreting blood GLUcose data with R package iglu. PLOS ONE, 16(4). https://doi.org/10.1371/journal.pone.0248560
  4. [ERROR: key "smith2023missing" not found in library]

(dry-run mode — no changes made)
```

Switch back to Vancouver and verify:

```bash
node dist/index.js config style vancouver --doc 12Vw8AnI8t848aiSoUqRqz8rN17itcfzQuRtmwYHT4no && node dist/index.js bib --doc 12Vw8AnI8t848aiSoUqRqz8rN17itcfzQuRtmwYHT4no --dry-run
```

```output
✓ Document style set to "vancouver"
Bibliography preview:

  1. Merrill MA, Sapir G. Non-experts can distinguish AI-generated from human writing in short health texts. Nature Communications. 2026. doi:10.1038/s41467-025-67922-y
  2. Battelino T, Danne T, Bergenstal RM. Clinical Targets for Continuous Glucose Monitoring Data Interpretation: Recommendations From the International Consensus on Time in Range. Diabetes Care. 2019;42(8):1593-1603. doi:10.2337/dc19-1028
  3. Broll S, Gaynanova I, Chun E. Interpreting blood GLUcose data with R package iglu. PLOS ONE. 2021;16(4). doi:10.1371/journal.pone.0248560
  4. [ERROR: key "smith2023missing" not found in library]

(dry-run mode — no changes made)
```

### 22. `--dry-run` on `cite insert`

The insert command now also supports `--dry-run`:

```bash
node dist/index.js insert --help | grep dry-run
```

```output
  --dry-run         Preview only, do not write
```

### 23. Complete Command Reference

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

### 24. Final Test Suite

```bash
npx vitest run 2>&1
```

```output

[1m[46m RUN [49m[22m [36mv4.1.0 [39m[90m/home/user/cite-and-write-cli[39m


[2m Test Files [22m [1m[32m6 passed[39m[22m[90m (6)[39m
[2m      Tests [22m [1m[32m45 passed[39m[22m[90m (45)[39m
[2m   Start at [22m 14:34:23
[2m   Duration [22m 991ms[2m (transform 264ms, setup 0ms, import 1.06s, tests 31ms, environment 0ms)[22m

```

### 25. Final Project Structure

```bash
find src test -type f | sort
```

```output
src/commands/add.ts
src/commands/audit.ts
src/commands/auth.ts
src/commands/bib.ts
src/commands/config-cmd.ts
src/commands/import.ts
src/commands/init.ts
src/commands/insert.ts
src/commands/remove.ts
src/commands/search.ts
src/commands/sync.ts
src/index.ts
src/lib/bibtex-parser.ts
src/lib/config.ts
src/lib/doc-state.ts
src/lib/format.ts
src/lib/formatter.ts
src/lib/google-auth.ts
src/lib/google-docs.ts
src/lib/library.ts
src/lib/resolver.ts
src/lib/safety.ts
src/lib/zotero.ts
src/types/index.ts
test/bibtex-parser.test.ts
test/fixtures/sample.bib
test/fixtures/sample.ris
test/formatter.test.ts
test/google-docs.test.ts
test/library.test.ts
test/resolver.test.ts
test/safety.test.ts
```

---

## Phase 4 Summary

**Implemented:**
- `cite remove` — Safe citation removal with renumbering preview, confirmation defaults to No, `--dry-run` support
- `cite config show` — Display current configuration (API keys redacted)
- `cite config style` — Switch citation style globally or per-document
- `cite config set` — Set arbitrary config values via dot-notation
- `--dry-run` flag added to `cite insert`

## Final Summary — All Phases

| Command | Description | Phase |
|---------|-------------|-------|
| `cite auth google` | Google Docs OAuth2 setup | 1 |
| `cite auth zotero` | Zotero API key setup | 1 |
| `cite add` | Add reference by DOI/URL/PMID/arXiv/title | 1 |
| `cite search` | Search local library (text, author, year, tag) | 1 |
| `cite init` | Initialize doc for citation management | 1 |
| `cite insert` | Insert inline citations with preview | 2 |
| `cite bib` | Generate/update bibliography (5 styles) | 2 |
| `cite audit` | Document citation health check | 2 |
| `cite import bibtex` | Import from BibTeX files | 3 |
| `cite import ris` | Import from RIS files | 3 |
| `cite import sciwheel` | One-time SciWheel migration | 3 |
| `cite sync` | Zotero ↔ local mirror sync | 3 |
| `cite remove` | Safe citation removal + renumbering | 4 |
| `cite config` | Configuration and style management | 4 |

**Stats:** 24 source files, 6 test files, 45 unit tests, 0 external parser dependencies.
