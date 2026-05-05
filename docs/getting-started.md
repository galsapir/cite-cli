# Getting Started

This guide walks you through setting up `cite` from scratch — creating accounts, configuring API access, and running your first citation workflow.

## 1. Install cite

```bash
git clone <repo-url>
cd cite-and-write-cli
npm install
npm run build
```

The CLI is available as `node dist/index.js` (or `cite` if installed globally via `npm link`).

## 2. Create a Zotero Account

[Zotero](https://www.zotero.org/) is the cloud backend for your citation library. cite syncs references to Zotero so they're accessible from anywhere.

1. Go to [zotero.org/user/register](https://www.zotero.org/user/register) and create an account
2. Go to [zotero.org/settings/keys/new](https://www.zotero.org/settings/keys/new) to create an API key:
   - **Key name**: `cite-cli`
   - **Personal Library**: check **Allow library access** (read/write)
   - Click **Save Key**
3. Note two values:
   - **API Key** — the long string shown after saving
   - **User ID** — shown at [zotero.org/settings/keys](https://www.zotero.org/settings/keys) ("Your userID for use in API calls is XXXXXX")

### Run the auth command

```bash
cite auth zotero
```

Enter your API key and user ID when prompted. Credentials are saved to `~/.cite/config.yaml`.

## 3. Set Up Google Docs API Access

cite reads and writes Google Docs through the Google Docs API. This requires a Google Cloud project with OAuth2 credentials.

### Create a Google Cloud project

1. Go to [console.cloud.google.com](https://console.cloud.google.com/)
2. Sign in with the Google account that owns your docs
3. Click the project selector → **New Project**
4. Name it `cite-cli` → **Create**

### Enable the Google Docs API

1. Go to **APIs & Services → Library**
2. Search for **Google Docs API**
3. Click **Enable**

### Configure the OAuth consent screen

1. Go to **APIs & Services → OAuth consent screen**
2. Choose **External** user type
3. Fill in:
   - **App name**: `cite-cli`
   - **User support email**: your email
   - **Developer contact**: your email
4. Click through the remaining steps (no scopes needed manually — the CLI requests them)
5. Under **Audience**, set publishing status to **In production** so any Google account can authorize (you'll see a "Google hasn't verified this app" warning — that's fine for personal use; click Advanced → Continue)

### Create OAuth credentials

1. Go to **APIs & Services → Credentials**
2. Click **Create Credentials → OAuth client ID**
3. Application type: **Desktop app**
4. Name: `cite-cli`
5. Click **Create** and **Download JSON**
6. Save the file to `~/.cite/google-credentials.json`

### Run the auth command

```bash
cite auth google
```

This opens a browser window for Google authorization. Sign in, approve access, and the token is saved automatically.

## 4. Your First Citation Workflow

`cite` works against either a Google Doc or a local markdown file. Pick whichever fits your writing setup; the rest of this guide shows the Google Docs walkthrough first, then a shorter markdown alternative.

### Add some papers

```bash
# Add by DOI
cite add "10.1038/s41586-020-2649-2"

# Add by DOI (another)
cite add "10.1056/NEJMra2301725"
```

### Check your library

```bash
cite search
```

### Path A — Google Docs

#### Initialize a Google Doc

Get the doc ID from the URL — it's the long string between `/d/` and `/edit`:

```
https://docs.google.com/document/d/THIS_IS_THE_DOC_ID/edit
```

```bash
cite init --doc <DOC_ID>
```

#### Insert citations

```bash
# Insert after specific text in the document
cite insert --doc <DOC_ID> --key harris2020 --after "some sentence in your doc"

# Preview without modifying
cite insert --doc <DOC_ID> --key rajpurkar2023 --after "another sentence" --dry-run
```

#### Generate bibliography

```bash
# Place bibliography after "References" heading
cite bib --doc <DOC_ID> --after "References"
```

#### Audit for consistency

```bash
cite audit --doc <DOC_ID>
```

### Path B — local markdown

Write in any editor (Obsidian, VS Code, vim, …). Paste DOI/PubMed/PMC/arXiv/Nature URLs as standard markdown links — `[Author](https://doi.org/...)` — while drafting, then run `cite scan` to convert them to pandoc-style `[@bibkey]` markers.

```bash
# Initialize the markdown file as a cite-tracked source
cite init --markdown docs/draft.md --library group/12345 --style vancouver

# (optional) make it the active source so subsequent commands don't need --markdown
cite use --markdown docs/draft.md

# Convert pasted academic links to [@bibkey] markers
cite scan

# Generate / update the bibliography under a `## References` heading
cite bib
```

`insert`, `audit`, `refresh`, and `remove` are not yet markdown-aware (tracked in [issue #19](https://github.com/galsapir/cite-cli/issues/19)). For a markdown-only workflow, `scan` and `bib` are typically all you need.

To migrate an existing cite-cli'd Google Doc into the markdown workflow, use `cite export` — see [Usage Guide → export](usage.md#export).

## 5. Importing Existing References

If you have references in BibTeX, RIS, or SciWheel, see [importing.md](importing.md) for import instructions.

## 6. Syncing with Zotero

After adding references locally or through Zotero's desktop app/browser extension:

```bash
cite sync
```

This merges local and cloud libraries, deduplicating by DOI and Zotero key.

## Troubleshooting

### "Google credentials file not found"

Make sure the downloaded OAuth JSON is at `~/.cite/google-credentials.json`, or set a custom path:

```bash
cite config set google.credentialsPath /path/to/credentials.json
```

### "Zotero auth not configured"

Run `cite auth zotero` and enter your API key and user ID.

### "Google hasn't verified this app" warning

This is expected for personal OAuth apps. Click **Advanced → Go to cite-cli (unsafe)** to proceed.

### Token expired

Re-run `cite auth google` to refresh the token.
