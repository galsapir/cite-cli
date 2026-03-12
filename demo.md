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
