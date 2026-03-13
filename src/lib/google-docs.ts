// ABOUTME: Google Docs API client for fetching and modifying documents.
// ABOUTME: Provides text extraction, search, and batch update operations.

import { google, type docs_v1 } from "googleapis";
import { getGoogleAuth } from "./google-auth.js";

export interface DocContent {
  title: string;
  revisionId: string;
  body: docs_v1.Schema$StructuralElement[];
  namedRanges: Record<string, docs_v1.Schema$NamedRange[]>;
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
    namedRanges: (doc.namedRanges as Record<string, docs_v1.Schema$NamedRange[]>) || {},
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
