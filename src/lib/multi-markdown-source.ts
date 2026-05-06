// ABOUTME: DocumentSource implementation that composes markdown files from a manifest.
// ABOUTME: Reads body files in manifest order and keeps the bibliography target separate.

import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { MarkdownDocumentSource, type MarkdownCursor } from "./markdown-source.js";
import type { Manifest } from "./manifest.js";
import type {
  BibWriteOptions,
  BibWriteOutcome,
  DocumentSource,
  LoadRefsOutcome,
  PendingReference,
  PresentCitationsOutcome,
  ScanWriteItem,
  ScanWriteOutcome,
} from "./document-source.js";
import type { CitationStyle, LibraryEntry } from "../types/index.js";

export interface MultiMarkdownCursor {
  fileIdx: number;
  child: MarkdownCursor;
}

export type { MarkdownCursor };

export class ManifestChangedDuringRunError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ManifestChangedDuringRunError";
  }
}

export class MultiMarkdownDocumentSource implements DocumentSource {
  readonly kind = "markdown-manifest" as const;

  readonly manifestPath: string;

  readonly manifestDir: string;

  readonly bodyChildren: readonly MarkdownDocumentSource[];

  readonly bibChild: MarkdownDocumentSource;

  constructor(manifest: Manifest) {
    this.manifestPath = manifest.manifestPath;
    this.manifestDir = manifest.manifestDir;
    this.bodyChildren = manifest.bodyFilePaths.map((filePath) => new MarkdownDocumentSource(filePath));
    this.bibChild = new MarkdownDocumentSource(manifest.bibFilePath);
  }

  describe(): string {
    return `markdown-manifest:${this.manifestPath}`;
  }

  async revisionToken(): Promise<string> {
    const manifestText = await readFile(this.manifestPath, "utf-8");
    const children = [...this.bodyChildren, this.bibChild];
    const childTokens = await Promise.all(children.map((child) => revisionTokenForChild(child)));
    const manifestHash = createHash("sha1").update(manifestText).digest("hex");
    return createHash("sha1")
      .update(`${childTokens.join("\n")}\n---\n${manifestHash}`)
      .digest("hex")
      .slice(0, 24);
  }

  async loadAcademicReferences(): Promise<LoadRefsOutcome> {
    const refs: PendingReference[] = [];
    for (const [fileIdx, child] of this.bodyChildren.entries()) {
      const outcome = await child.loadAcademicReferences();
      refs.push(
        ...outcome.refs.map((ref) => ({
          ...ref,
          cursor: { fileIdx, child: ref.cursor as MarkdownCursor } satisfies MultiMarkdownCursor,
        })),
      );
    }
    return { refs, revisionToken: await this.revisionToken() };
  }

  async findPresentCitationKeys(): Promise<PresentCitationsOutcome> {
    const keys = new Set<string>();
    for (const child of this.bodyChildren) {
      const outcome = await child.findPresentCitationKeys();
      for (const key of outcome.keys) keys.add(key);
    }
    return { keys, revisionToken: await this.revisionToken() };
  }

  async writeScanResults(
    _items: ScanWriteItem[],
    _style: CitationStyle,
    _library: LibraryEntry[],
  ): Promise<ScanWriteOutcome> {
    throw new Error(
      "MultiMarkdownDocumentSource.writeScanResults is not implemented in Phase 1A " +
      "of issue #20. Manifest-aware scan ships in Phase 2; for now use " +
      "'cite scan --markdown <single-file>' instead.",
    );
  }

  async writeBibliography(
    _text: string,
    _options: BibWriteOptions,
  ): Promise<BibWriteOutcome> {
    throw new Error(
      "MultiMarkdownDocumentSource.writeBibliography is not implemented in Phase 1A " +
      "of issue #20. Manifest-aware bibliography generation ships in Phase 2; for now use " +
      "'cite bib --markdown <single-file>' instead.",
    );
  }
}

async function revisionTokenForChild(child: MarkdownDocumentSource): Promise<string> {
  try {
    return await child.revisionToken();
  } catch (err: any) {
    if (err.code === "ENOENT") return `missing:${child.filePath}`;
    throw err;
  }
}
