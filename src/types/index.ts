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

/** Per-doc citation state */
export interface DocState {
  docId: string;
  libraryId: string;
  style: string;
  citations: CitationEntry[];
  bibNamedRange?: string;
  lastSync: string;
  revisionId?: string;
}

export interface CitationEntry {
  index: number;
  key: string;
  location: string;
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
    style?: string;
    confirmBeforeWrite?: boolean;
    autoSyncBib?: boolean;
  };
}

/** Supported identifier types for cite add */
export type IdentifierType = "doi" | "pmid" | "arxiv" | "url" | "title";

export interface ResolvedReference {
  identifier: string;
  identifierType: IdentifierType;
  csl: CslJson;
  suggestedKey: string;
}
