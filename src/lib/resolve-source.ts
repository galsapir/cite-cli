// ABOUTME: CLI helper that constructs a DocumentSource from --doc / --markdown / --manifest options.
// ABOUTME: Lives in its own module to avoid circular deps between source impls.

import { GoogleDocsSource } from "./google-docs.js";
import { MarkdownDocumentSource } from "./markdown-source.js";
import { MultiMarkdownDocumentSource } from "./multi-markdown-source.js";
import { stateKeyForSource } from "./doc-state.js";
import { loadManifest } from "./manifest.js";
import { loadConfig, resolveDocId } from "./config.js";
import type { DocumentSource } from "./document-source.js";

export interface SourceResolveOptions {
  /** Google Doc ID, if the user passed --doc. */
  doc?: string;
  /** Markdown file path, if the user passed --markdown. */
  markdown?: string;
  /** Markdown manifest path, if the user passed --manifest. */
  manifest?: string;
}

export interface ResolvedSource {
  source: DocumentSource;
  /** State filename key (`<docId>` for Google Docs, `md_<sha1>` for markdown). */
  stateKey: string;
  /** Echo the inputs so callers can include them in log/error messages. */
  options: SourceResolveOptions;
}

/** Format the `cite init …` hint for the resolved source — used in not-initialized errors. */
export function initHintForSource(resolved: ResolvedSource): string {
  if (resolved.source.kind === "markdown") {
    const path = resolved.options.markdown ?? "(unknown)";
    return `cite init --markdown ${path}`;
  }
  if (resolved.source.kind === "markdown-manifest") {
    const path = resolved.options.manifest ?? "(unknown)";
    return `cite init --manifest ${path}`;
  }
  return `cite init --doc ${resolved.stateKey}`;
}

/**
 * Build the right DocumentSource for a command run.
 * Precedence: explicit `--manifest` > explicit `--markdown` > explicit `--doc` > config `defaults.manifest` > config `defaults.markdown` > config `defaults.doc`.
 */
export async function resolveSource(opts: SourceResolveOptions): Promise<ResolvedSource> {
  const explicitSources = [opts.doc, opts.markdown, opts.manifest].filter(Boolean);
  if (explicitSources.length > 1) {
    process.stderr.write("Error: pass at most one of --doc, --markdown, --manifest.\n");
    process.exit(1);
  }

  if (opts.manifest) {
    const manifest = await loadManifest(opts.manifest);
    const source = new MultiMarkdownDocumentSource(manifest);
    return {
      source,
      stateKey: stateKeyForSource({ type: "markdown-manifest", manifestPath: source.manifestPath }),
      options: opts,
    };
  }

  if (opts.markdown) {
    const source = new MarkdownDocumentSource(opts.markdown);
    return {
      source,
      stateKey: stateKeyForSource({ type: "markdown", filePath: source.filePath }),
      options: opts,
    };
  }

  const config = await loadConfig();
  const activeManifest = config.defaults?.manifest;
  if (!opts.doc && !opts.markdown && activeManifest) {
    const manifest = await loadManifest(activeManifest);
    const source = new MultiMarkdownDocumentSource(manifest);
    return {
      source,
      stateKey: stateKeyForSource({ type: "markdown-manifest", manifestPath: source.manifestPath }),
      options: { manifest: activeManifest },
    };
  }

  const activeMarkdown = config.defaults?.markdown;
  if (!opts.doc && activeMarkdown) {
    const source = new MarkdownDocumentSource(activeMarkdown);
    return {
      source,
      stateKey: stateKeyForSource({ type: "markdown", filePath: source.filePath }),
      options: { markdown: activeMarkdown },
    };
  }

  const docId = await resolveDocId(opts.doc);
  return {
    source: new GoogleDocsSource(docId),
    stateKey: docId,
    options: { doc: docId },
  };
}
