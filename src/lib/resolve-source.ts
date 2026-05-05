// ABOUTME: CLI helper that constructs a DocumentSource from --doc / --markdown options.
// ABOUTME: Lives in its own module to avoid circular deps between source impls.

import { GoogleDocsSource } from "./google-docs.js";
import { MarkdownDocumentSource } from "./markdown-source.js";
import { stateKeyForSource } from "./doc-state.js";
import { loadConfig, resolveDocId } from "./config.js";
import type { DocumentSource } from "./document-source.js";

export interface SourceResolveOptions {
  /** Google Doc ID, if the user passed --doc. */
  doc?: string;
  /** Markdown file path, if the user passed --markdown. */
  markdown?: string;
}

export interface ResolvedSource {
  source: DocumentSource;
  /** State filename key (`<docId>` for Google Docs, `md_<sha1>` for markdown). */
  stateKey: string;
  /** Echo the inputs so callers can include them in log/error messages. */
  options: SourceResolveOptions;
}

/**
 * Reject if the resolved source is markdown — used by commands that haven't
 * been wired to the markdown backend yet (insert/audit/refresh/remove).
 * Process exits non-zero with a friendly message.
 */
export function requireGoogleDocsSource(
  resolved: ResolvedSource,
  commandName: string,
): void {
  if (resolved.source.kind === "markdown") {
    const path = resolved.options.markdown ?? "the markdown file";
    process.stderr.write(
      `Error: 'cite ${commandName}' is not yet markdown-aware.\n` +
      `       Source: ${path}\n` +
      `       For now, use 'cite scan' / 'cite bib' for markdown, or pass --doc to operate on a Google Doc.\n`,
    );
    process.exit(1);
  }
}

/** Format the `cite init …` hint for the resolved source — used in not-initialized errors. */
export function initHintForSource(resolved: ResolvedSource): string {
  if (resolved.source.kind === "markdown") {
    const path = resolved.options.markdown ?? "(unknown)";
    return `cite init --markdown ${path}`;
  }
  return `cite init --doc ${resolved.stateKey}`;
}

/**
 * Build the right DocumentSource for a command run.
 * Precedence: explicit `--markdown` > explicit `--doc` > config `defaults.markdown` > config `defaults.doc`.
 */
export async function resolveSource(opts: SourceResolveOptions): Promise<ResolvedSource> {
  if (opts.markdown && opts.doc) {
    process.stderr.write("Error: pass either --doc or --markdown, not both.\n");
    process.exit(1);
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
