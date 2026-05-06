// ABOUTME: DocumentSource implementation that composes markdown files from a manifest.
// ABOUTME: Reads, scans, inserts, removes, and writes bibs across manifest children.

import { access, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import {
  acquireMarkdownLock,
  MarkdownDocumentSource,
  type MarkdownCitationOccurrence,
  type MarkdownCursor,
  type MarkdownInsertAnchor,
} from "./markdown-source.js";
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

export interface MultiCitationOccurrence {
  fileIdx: number;
  occurrence: MarkdownCitationOccurrence;
}

export type { MarkdownCitationOccurrence, MarkdownCursor, MarkdownInsertAnchor };

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

  async runWithLock<T>(operation: () => Promise<T>): Promise<T> {
    const children = [...this.bodyChildren];
    if (!children.some((child) => child.filePath === this.bibChild.filePath)) {
      children.push(this.bibChild);
    }

    const releases: Array<() => Promise<void>> = [];
    try {
      for (const child of children) {
        try {
          releases.push(await acquireMarkdownLock(child.filePath));
        } catch (err) {
          for (const release of releases.reverse()) await release().catch(() => {});
          releases.length = 0;
          throw err;
        }
      }
      return await operation();
    } finally {
      for (const release of releases.reverse()) await release().catch(() => {});
    }
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

  async scanCitationOccurrences(): Promise<MultiCitationOccurrence[]> {
    const out: MultiCitationOccurrence[] = [];
    for (const [fileIdx, child] of this.bodyChildren.entries()) {
      const occurrences = await child.scanCitationOccurrences();
      for (const occurrence of occurrences) out.push({ fileIdx, occurrence });
    }
    return out;
  }

  async findPresentCitationKeysByFile(): Promise<Map<string, number[]>> {
    const byKey = new Map<string, number[]>();
    for (const [fileIdx, child] of this.bodyChildren.entries()) {
      const outcome = await child.findPresentCitationKeys();
      for (const key of outcome.keys) {
        const indices = byKey.get(key) ?? [];
        indices.push(fileIdx);
        byKey.set(key, indices);
      }
    }
    return byKey;
  }

  async removeCiteKey(key: string): Promise<{
    bodyOccurrencesRemoved: number;
    bracketsRewritten: number;
    bracketsDeleted: number;
    newRevisionToken: string;
    perFile: Array<{ fileIdx: number | "bib"; removed: number }>;
  }> {
    const targets: Array<{ idx: number | "bib"; child: MarkdownDocumentSource }> = [
      ...this.bodyChildren.map((child, idx) => ({ idx, child })),
    ];
    if (!this.bodyChildren.some((child) => child.filePath === this.bibChild.filePath)) {
      targets.push({ idx: "bib", child: this.bibChild });
    }

    let bodyOccurrencesRemoved = 0;
    let bracketsRewritten = 0;
    let bracketsDeleted = 0;
    const perFile: Array<{ fileIdx: number | "bib"; removed: number }> = [];
    let processed = 0;

    for (const { idx, child } of targets) {
      try {
        const outcome = await child.removeCiteKey(key);
        bodyOccurrencesRemoved += outcome.bodyOccurrencesRemoved;
        bracketsRewritten += outcome.bracketsRewritten;
        bracketsDeleted += outcome.bracketsDeleted;
        perFile.push({ fileIdx: idx, removed: outcome.bodyOccurrencesRemoved });
        processed++;
      } catch (err: any) {
        throw new ManifestPartialWriteError(
          `Removed from ${processed} of ${targets.length} files. Failed at ${child.filePath}: ${err.message}. Re-run; 'cite refresh' reconciles state.`,
        );
      }
    }

    return {
      bodyOccurrencesRemoved,
      bracketsRewritten,
      bracketsDeleted,
      newRevisionToken: await this.revisionToken(),
      perFile,
    };
  }

  async locateInsertionPointInFile(fileIdx: number, anchor: MarkdownInsertAnchor): Promise<number> {
    const child = this.bodyChildren[fileIdx];
    if (!child) {
      throw new RangeError(`fileIdx ${fileIdx} out of bounds for bodyChildren (length ${this.bodyChildren.length}).`);
    }
    return child.locateInsertionPoint(anchor);
  }

  async writeInsertionInFile(fileIdx: number, offset: number, marker: string): Promise<{ newRevisionToken: string }> {
    const child = this.bodyChildren[fileIdx];
    if (!child) throw new RangeError(`fileIdx ${fileIdx} out of bounds.`);
    await child.writeInsertion(offset, marker);
    return { newRevisionToken: await this.revisionToken() };
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

    // Bib is excluded from loadAcademicReferences / findPresentCitationKeys,
    // so bibChild has no loadedRevisionToken from that side. revisionToken()
    // populates cachedContent without setting it. Establish the write
    // precondition explicitly so the delegated writeBibliography catches
    // mid-run drift (a concurrent edit between the bib read and our write).
    await this.bibChild.establishWritePrecondition();
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
