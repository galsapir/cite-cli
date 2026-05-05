// ABOUTME: TypeScript type definitions for the cite CLI.
// ABOUTME: Covers CSL-JSON, library entries, doc state, config, and identifiers.

/** CSL-JSON reference metadata */
export interface CslJson {
  id: string;
  type: string;
  title?: string;
  author?: Array<{ given?: string; family?: string; literal?: string }>;
  issued?: { "date-parts"?: number[][]; raw?: string };
  "container-title"?: string;
  volume?: string;
  issue?: string;
  page?: string;
  DOI?: string;
  URL?: string;
  PMID?: string;
  abstract?: string;
  publisher?: string;
  ISSN?: string;
  ISBN?: string;
  [key: string]: unknown;
}

/** A reference in the local library with a cite-key */
export interface LibraryEntry {
  key: string; // e.g. "battelino2019"
  csl: CslJson;
  addedAt: string; // ISO timestamp
  tags?: string[];
  zoteroKey?: string; // Zotero item key for sync
}

/** Discriminated union identifying the document a state record points to. */
export type DocSource =
  | { type: "google-docs"; docId: string }
  | { type: "markdown"; filePath: string };

/** Per-doc citation state */
export interface DocState {
  /** Stable filename key for this state record (e.g. Google Doc ID, or `md_<sha1>`). */
  docId: string;
  /** Where the document lives — Google Docs or a local markdown file. */
  source: DocSource;
  libraryId: string;
  style: CitationStyle;
  citations: CitationEntry[];
  /**
   * For Google Docs: the named-range name that wraps the bibliography section.
   * For markdown: the level-2 heading text under which the bibliography lives
   *   (default "References" when first generated).
   */
  bibNamedRange?: string;
  lastSync: string;
  /**
   * For Google Docs: Google's revisionId.
   * For markdown: an opaque token derived from mtime + content hash.
   */
  revisionId?: string;
}

export interface CitationEntry {
  index: number;
  key: string;
  location: string;
  namedRangeIds?: string[]; // Google Docs named range IDs for each occurrence of this marker
}

/** Per-library settings */
export interface LibraryConfig {
  collection?: string; // Default Zotero collection name for this library
}

/** Global config (~/.cite/config.yaml) */
export interface CiteConfig {
  zotero?: {
    apiKey?: string;
    userId?: string;
    defaultLibrary?: string;
  };
  google?: {
    credentialsPath?: string;
    tokenPath?: string;
  };
  defaults?: {
    doc?: string;
    collection?: string;
    style?: string;
    confirmBeforeWrite?: boolean;
    autoSyncBib?: boolean;
  };
  libraries?: Record<string, LibraryConfig>;
}

/** URL prefix for citation hyperlinks (survives copy/paste as a durability fallback) */
export const CITE_LINK_PREFIX = "https://cite-cli.local/ref/";

/** Named range prefix for inline citations */
export const CITE_RANGE_PREFIX = "cite:";

/** Supported citation styles */
export type CitationStyle = "vancouver" | "apa" | "nature" | "ieee" | "chicago-author-date";

/** Supported identifier types for cite add */
export type IdentifierType = "doi" | "pmid" | "arxiv" | "url" | "title";

export interface ResolvedReference {
  identifier: string;
  identifierType: IdentifierType;
  csl: CslJson;
  suggestedKey: string;
}
