// ABOUTME: DocumentSource implementation that composes markdown files from a manifest.
// ABOUTME: Reads body files in manifest order and keeps the bibliography target separate.

import { access, readFile, writeFile } from "node:fs/promises";
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

export class ManifestPartialWriteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ManifestPartialWriteError";
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
    items: ScanWriteItem[],
    style: CitationStyle,
    library: LibraryEntry[],
  ): Promise<ScanWriteOutcome> {
    const byFile = new Map<number, ScanWriteItem[]>();
    for (const item of items) {
      const cursor = item.ref.cursor as MultiMarkdownCursor;
      if (!byFile.has(cursor.fileIdx)) byFile.set(cursor.fileIdx, []);
      byFile.get(cursor.fileIdx)!.push({
        ...item,
        ref: { ...item.ref, cursor: cursor.child },
      });
    }

    const occurrenceHandles: Record<string, string[]> = {};
    const fileIdxs = [...byFile.keys()].sort((a, b) => a - b);
    let written = 0;
    for (const fileIdx of fileIdxs) {
      const child = this.bodyChildren[fileIdx];
      try {
        const outcome = await child.writeScanResults(byFile.get(fileIdx)!, style, library);
        for (const [key, childHandles] of Object.entries(outcome.occurrenceHandles)) {
          if (!occurrenceHandles[key]) occurrenceHandles[key] = [];
          for (const handle of childHandles) {
            // Namespaces child handles as `${fileIdx}:${childHandle}` for cross-file uniqueness.
            occurrenceHandles[key].push(`${fileIdx}:${handle}`);
          }
        }
        written++;
      } catch (err: any) {
        throw new ManifestPartialWriteError(
          `Wrote ${written} of ${fileIdxs.length} files. Failed at ${child.filePath}: ${err.message}. Re-run; 'cite refresh' reconciles state.`,
        );
      }
    }

    return { occurrenceHandles, newRevisionToken: await this.revisionToken() };
  }

  async writeBibliography(
    text: string,
    options: BibWriteOptions,
  ): Promise<BibWriteOutcome> {
    try {
      await access(this.bibChild.filePath);
    } catch (err: any) {
      if (err.code !== "ENOENT") throw err;
      await writeFile(this.bibChild.filePath, "", "utf-8");
    }

    const outcome = await this.bibChild.writeBibliography(text, options);
    return { ...outcome, newRevisionToken: await this.revisionToken() };
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
