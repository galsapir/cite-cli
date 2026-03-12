# Importing References

cite supports importing references from BibTeX files, RIS files, and SciWheel projects.

## From BibTeX

BibTeX (`.bib`) is the most common citation exchange format. Export from Zotero, Mendeley, Google Scholar, or any reference manager.

```bash
cite import bibtex references.bib
cite import bibtex references.bib -y              # Skip confirmation
cite import bibtex references.bib --library group/12345  # Target specific library
```

### Getting BibTeX from common sources

**Google Scholar**: Click the cite icon (") below a paper → BibTeX link at the bottom.

**Zotero Desktop**: Select items → Right-click → Export Items → BibTeX format.

**Mendeley**: Select references → File → Export → BibTeX.

## From RIS

RIS (`.ris`) is another common format supported by most reference managers and databases.

```bash
cite import ris references.ris
cite import ris references.ris -y
```

### Getting RIS files

**PubMed**: Search results → Send to → Citation manager → Create File.

**Web of Science**: Select records → Export → RIS.

**Scopus**: Select documents → Export → RIS format.

## From SciWheel (F1000Workspace)

SciWheel (formerly F1000Workspace) is a reference manager popular in biomedical research. cite supports a one-time export from a SciWheel project.

### Getting your SciWheel credentials

1. Log in to [sciwheel.com](https://sciwheel.com)
2. Open your project
3. The **project ID** is in the URL: `sciwheel.com/work/#/project/<PROJECT_ID>/...`
4. For the **API token**, open browser DevTools (F12) → Network tab → find any API request → copy the `Authorization: Bearer <TOKEN>` header value

### Running the import

```bash
cite import sciwheel --project <PROJECT_ID> --token <BEARER_TOKEN>
cite import sciwheel --project <PROJECT_ID> --token <BEARER_TOKEN> -y
```

This fetches references from the SciWheel API as BibTeX and imports them into your local library.

## After importing

Imported references are saved to your local library. To push them to Zotero:

```bash
cite sync
```

To verify the import:

```bash
cite search
```
