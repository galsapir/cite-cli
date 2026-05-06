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

## 3. Your First Citation Workflow

`cite` is markdown-first. Start with a manifest when the manuscript has multiple files; use single-file markdown for smaller drafts; use Google Docs when real-time collaboration matters.

### Path A — multi-file markdown manifest

Create body files and a bibliography target:

```bash
mkdir -p manuscript
cd manuscript
touch 00-abstract.md 01-introduction.md 02-methods.md 03-results.md 04-discussion.md
cat > cite.manifest.yaml <<'EOF'
files:
  - 00-abstract.md
  - 01-introduction.md
  - 02-methods.md
  - 03-results.md
  - 04-discussion.md
bibliography: references.md
EOF
```

Initialize the manifest, sync the maintainer example group library, and set it as the active source. Replace `group/6466726` and `preprint-cits` with your own library and collection.

```bash
cite init --manifest cite.manifest.yaml --library group/6466726 --style vancouver
cite sync --library group/6466726 --collection preprint-cits
cite use --manifest cite.manifest.yaml --collection preprint-cits
```

Draft with academic URLs as markdown links:

```bash
cat >> 01-introduction.md <<'EOF'
Khasentino et al. reported PHA-related findings [Khasentino](https://doi.org/10.1038/s41591-025-03888-0).

Health-LLM is available on arXiv [Health-LLM](https://arxiv.org/abs/2401.06866).
EOF
```

Process citations and bibliography:

```bash
cite scan
cite bib
cite audit
```

`cite scan` replaces the links with pandoc-style `[@bibkey]` markers. `cite bib` writes `references.md`. For the full manifest schema and gotchas, see [Manifest Reference](manifest.md).

### Path B — single-file markdown

Write in any editor (Obsidian, VS Code, vim, …). Paste DOI/PubMed/PMC/arXiv/Nature URLs as standard markdown links — `[Author](https://doi.org/...)` — while drafting, then run `cite scan` to convert them to pandoc-style `[@bibkey]` markers.

```bash
touch draft.md
cite init --markdown draft.md --library group/6466726 --style vancouver
cite use --markdown draft.md
cite scan
cite bib
```

`scan`, `bib`, `audit`, `refresh`, `remove`, and `insert` all work against markdown. `insert` needs an anchor such as `--after "some text"` or `--paragraph 5`.

### Finding your Zotero group ID

Open the group in the Zotero web UI and read the numeric ID from `zotero.org/groups/<id>/...`. To list groups from the API instead, use the curl recipe in [Manifest Reference → Library setup with a Zotero group](manifest.md#library-setup-with-a-zotero-group).

## 4. Optional: Set Up Google Docs API Access

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

### Google Docs workflow

#### Initialize a Google Doc

Get the doc ID from the URL — it's the long string between `/d/` and `/edit`:

```
https://docs.google.com/document/d/THIS_IS_THE_DOC_ID/edit
```

```bash
cite init --doc <DOC_ID> --library group/6466726 --style vancouver
cite use --doc <DOC_ID> --collection my-paper
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
