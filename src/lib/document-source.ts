// ABOUTME: Backend-agnostic interface for citation-bearing documents.
// ABOUTME: Implemented by GoogleDocsSource (live) and MarkdownDocumentSource (Phase 1b).

import type { CitationStyle, LibraryEntry } from "../types/index.js";

/** Backend-specific positional handle for a pending academic reference. */
export type RefCursor = unknown;

/** A URL in the document that looks academic but hasn't been turned into a citation yet. */
export interface PendingReference {
  url: string;
  text: string;
  cursor: RefCursor;
}

/** A resolved item the caller wants converted into an inline citation marker. */
export interface ScanWriteItem {
  ref: PendingReference;
  key: string;
  index: number;
}

export interface ScanWriteOutcome {
  /** Map of cite key → backend-specific opaque occurrence handles (e.g. Google Docs namedRangeIds). */
  occurrenceHandles: Record<string, string[]>;
  newRevisionToken: string;
}

export interface BibWriteOptions {
  /** Insert the bibliography after this text on first run (Google Docs only). Ignored if the bib already exists. */
  afterText?: string;
  /** Persisted name for the bib region (Google Docs uses this as a named range; markdown ignores it). */
  bibRangeName?: string;
}

export interface BibWriteOutcome {
  bibRangeName: string;
  newRevisionToken: string;
}

export interface LoadRefsOutcome {
  refs: PendingReference[];
  revisionToken: string;
}

export interface PresentCitationsOutcome {
  keys: Set<string>;
  revisionToken: string;
}

export type DocumentSourceKind = "google-docs" | "markdown" | "markdown-manifest";

export interface DocumentSource {
  readonly kind: DocumentSourceKind;
  /** Human-readable identifier for logs and error messages. */
  describe(): string;
  /** Find pending academic-looking URLs that aren't yet citations. */
  loadAcademicReferences(): Promise<LoadRefsOutcome>;
  /** Replace each pending reference with an inline citation marker, in one atomic batch where possible. */
  writeScanResults(
    items: ScanWriteItem[],
    style: CitationStyle,
    library: LibraryEntry[],
  ): Promise<ScanWriteOutcome>;
  /** Discover citation keys currently present in the document body. */
  findPresentCitationKeys(): Promise<PresentCitationsOutcome>;
  /** Insert or replace the bibliography section. */
  writeBibliography(text: string, options: BibWriteOptions): Promise<BibWriteOutcome>;
}
