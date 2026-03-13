// ABOUTME: Google Docs API client for fetching and modifying documents.
// ABOUTME: Provides text extraction, search, and batch update operations.

import { google, type docs_v1 } from "googleapis";
import { getGoogleAuth } from "./google-auth.js";
import { CITE_RANGE_PREFIX, CITE_LINK_PREFIX } from "../types/index.js";

export interface DocContent {
  title: string;
  revisionId: string;
  body: docs_v1.Schema$StructuralElement[];
  // Google Docs returns `namedRanges` keyed by name, with each entry wrapping
  // an array of NamedRange occurrences — not a bare NamedRange[].
  namedRanges: docs_v1.Schema$Document["namedRanges"];
}

export interface TextLocation {
  paragraphIndex: number;
  startIndex: number;
  endIndex: number;
  text: string;
  context: string; // surrounding text for preview
}

/** Fetch a Google Doc and return parsed content */
export async function fetchDoc(docId: string): Promise<DocContent> {
  const auth = await getGoogleAuth();
  if (!auth) {
    throw new Error(
      "Google auth not configured. Run 'cite auth google' first.",
    );
  }

  const docs = google.docs({ version: "v1", auth });
  const res = await docs.documents.get({ documentId: docId });
  const doc = res.data;

  return {
    title: doc.title || "Untitled",
    revisionId: doc.revisionId || "",
    body: doc.body?.content || [],
    namedRanges: doc.namedRanges || {},
  };
}

/** Extract all text from a doc's structural elements */
export function extractText(elements: docs_v1.Schema$StructuralElement[]): string {
  let text = "";
  for (const el of elements) {
    if (el.paragraph) {
      for (const pe of el.paragraph.elements || []) {
        if (pe.textRun?.content) {
          text += pe.textRun.content;
        }
      }
    } else if (el.table) {
      for (const row of el.table.tableRows || []) {
        for (const cell of row.tableCells || []) {
          text += extractText(cell.content || []);
        }
      }
    }
  }
  return text;
}

/** Find the location of a search string in the document */
export function findTextLocation(
  elements: docs_v1.Schema$StructuralElement[],
  searchString: string,
  occurrence: number = 1,
): TextLocation | null {
  let currentOccurrence = 0;
  let paragraphIndex = 0;

  for (const el of elements) {
    if (el.paragraph) {
      let paragraphText = "";
      let paragraphStart = el.startIndex ?? 0;

      for (const pe of el.paragraph.elements || []) {
        if (pe.textRun?.content) {
          paragraphText += pe.textRun.content;
        }
      }

      let searchPos = 0;
      while (true) {
        const idx = paragraphText.indexOf(searchString, searchPos);
        if (idx === -1) break;

        currentOccurrence++;
        if (currentOccurrence === occurrence) {
          const absoluteStart = paragraphStart + idx;
          const absoluteEnd = absoluteStart + searchString.length;

          // Build context: ±50 chars
          const ctxStart = Math.max(0, idx - 50);
          const ctxEnd = Math.min(paragraphText.length, idx + searchString.length + 50);
          const context = paragraphText.slice(ctxStart, ctxEnd);

          return {
            paragraphIndex,
            startIndex: absoluteStart,
            endIndex: absoluteEnd,
            text: searchString,
            context,
          };
        }
        searchPos = idx + 1;
      }
      paragraphIndex++;
    }
  }
  return null;
}

/** Find a paragraph by 1-indexed number */
export function findParagraph(
  elements: docs_v1.Schema$StructuralElement[],
  paragraphNumber: number,
): { startIndex: number; endIndex: number } | null {
  let pIdx = 0;
  for (const el of elements) {
    if (el.paragraph) {
      pIdx++;
      if (pIdx === paragraphNumber) {
        return {
          startIndex: el.startIndex ?? 0,
          endIndex: el.endIndex ?? 0,
        };
      }
    }
  }
  return null;
}

/** A citation occurrence found via named ranges in the document */
export interface CitationOccurrence {
  key: string;
  namedRangeId: string;
  startIndex: number;
  endIndex: number;
}

/**
 * Google Docs returns `namedRanges` as `{ [name]: { name, namedRanges: NamedRange[] } }`
 * — a wrapper object keyed by name, not a bare array. Unwrap to the inner array.
 */
function unwrapNamedRanges(
  namedRanges: docs_v1.Schema$Document["namedRanges"],
  name: string,
): docs_v1.Schema$NamedRange[] {
  const entry = namedRanges?.[name];
  return entry?.namedRanges ?? [];
}

/** Find all citation occurrences for a given key using named ranges */
export function findCitationOccurrences(
  namedRanges: docs_v1.Schema$Document["namedRanges"],
  key: string,
): CitationOccurrence[] {
  const rangeName = `${CITE_RANGE_PREFIX}${key}`;
  const ranges = unwrapNamedRanges(namedRanges, rangeName);
  if (ranges.length === 0) return [];

  const occurrences: CitationOccurrence[] = [];
  for (const nr of ranges) {
    for (const range of nr.ranges || []) {
      if (range.startIndex != null && range.endIndex != null && nr.namedRangeId) {
        occurrences.push({
          key,
          namedRangeId: nr.namedRangeId,
          startIndex: range.startIndex,
          endIndex: range.endIndex,
        });
      }
    }
  }

  return occurrences;
}

/** Find all citation occurrences across all keys */
export function findAllCitationOccurrences(
  namedRanges: docs_v1.Schema$Document["namedRanges"],
): CitationOccurrence[] {
  const occurrences: CitationOccurrence[] = [];
  for (const name of Object.keys(namedRanges ?? {})) {
    if (!name.startsWith(CITE_RANGE_PREFIX)) continue;
    const key = name.slice(CITE_RANGE_PREFIX.length);
    const ranges = unwrapNamedRanges(namedRanges, name);
    for (const nr of ranges) {
      for (const range of nr.ranges || []) {
        if (range.startIndex != null && range.endIndex != null && nr.namedRangeId) {
          occurrences.push({
            key,
            namedRangeId: nr.namedRangeId,
            startIndex: range.startIndex,
            endIndex: range.endIndex,
          });
        }
      }
    }
  }
  return occurrences;
}

/** A citation found via hyperlink in the document (for paste repair) */
export interface HyperlinkCitation {
  keys: string[]; // cite-keys encoded in the URL
  startIndex: number;
  endIndex: number;
  text: string; // the linked text content
}

/** Shared hyperlink info extracted during document traversal */
interface HyperlinkElement {
  url: string;
  startIndex: number;
  endIndex: number;
  text: string;
}

/** Walk document structure and collect all hyperlink elements */
function collectHyperlinks(
  elements: docs_v1.Schema$StructuralElement[],
): HyperlinkElement[] {
  const results: HyperlinkElement[] = [];

  for (const el of elements) {
    if (el.paragraph) {
      for (const pe of el.paragraph.elements || []) {
        const url = pe.textRun?.textStyle?.link?.url;
        if (url && pe.startIndex != null && pe.endIndex != null) {
          results.push({
            url,
            startIndex: pe.startIndex,
            endIndex: pe.endIndex,
            text: pe.textRun?.content || "",
          });
        }
      }
    } else if (el.table) {
      for (const row of el.table.tableRows || []) {
        for (const cell of row.tableCells || []) {
          results.push(...collectHyperlinks(cell.content || []));
        }
      }
    }
  }

  return results;
}

/** Scan document body for citation hyperlinks matching our URL pattern */
export function findCitationHyperlinks(
  elements: docs_v1.Schema$StructuralElement[],
): HyperlinkCitation[] {
  return collectHyperlinks(elements)
    .filter((hl) => hl.url.startsWith(CITE_LINK_PREFIX))
    .map((hl) => {
      const keys = hl.url.slice(CITE_LINK_PREFIX.length).split(",").filter(Boolean);
      return { keys, startIndex: hl.startIndex, endIndex: hl.endIndex, text: hl.text };
    })
    .filter((hl) => hl.keys.length > 0);
}

/** URL patterns that indicate an academic reference */
const ACADEMIC_URL_PATTERNS: RegExp[] = [
  /doi\.org\//i,
  /dx\.doi\.org\//i,
  /pubmed\.ncbi\.nlm\.nih\.gov\//i,
  /pmc\.ncbi\.nlm\.nih\.gov\/articles\//i,
  /arxiv\.org\/abs\//i,
  /nature\.com\/articles\//i,
  /10\.\d{4,}\//,  // embedded DOI anywhere in URL
];

/** Check whether a URL points to an academic reference we can resolve */
export function isAcademicUrl(url: string): boolean {
  if (url.startsWith(CITE_LINK_PREFIX)) return false;
  return ACADEMIC_URL_PATTERNS.some((p) => p.test(url));
}

/** An academic hyperlink found in the document (not yet processed as a citation) */
export interface AcademicHyperlink {
  url: string;
  startIndex: number;
  endIndex: number;
  text: string;
}

/** Scan document body for hyperlinks pointing to academic URLs (DOI, PubMed, arXiv) */
export function findAcademicHyperlinks(
  elements: docs_v1.Schema$StructuralElement[],
): AcademicHyperlink[] {
  return collectHyperlinks(elements).filter((hl) => isAcademicUrl(hl.url));
}

/** Execute a batch update on a Google Doc, returns per-request replies */
export async function batchUpdate(
  docId: string,
  requests: docs_v1.Schema$Request[],
): Promise<docs_v1.Schema$Response[]> {
  const auth = await getGoogleAuth();
  if (!auth) {
    throw new Error(
      "Google auth not configured. Run 'cite auth google' first.",
    );
  }

  const docs = google.docs({ version: "v1", auth });
  const res = await docs.documents.batchUpdate({
    documentId: docId,
    requestBody: { requests },
  });
  return res.data.replies || [];
}
