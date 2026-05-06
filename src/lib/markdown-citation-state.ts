// ABOUTME: Shared helpers for rebuilding markdown citation state from body order.
// ABOUTME: Preserves existing citation metadata while deriving tight 1-based indices.

import type { CitationEntry } from "../types/index.js";
import type { MarkdownCitationOccurrence } from "./markdown-source.js";

export function firstAppearanceKeyOrder(occurrences: MarkdownCitationOccurrence[]): string[] {
  const keyOrder: string[] = [];
  for (const occurrence of occurrences) {
    if (!keyOrder.includes(occurrence.key)) keyOrder.push(occurrence.key);
  }
  return keyOrder;
}

export function rebuildMarkdownCitations(
  keyOrder: string[],
  existingCitations: CitationEntry[],
  defaultLocation: string,
): CitationEntry[] {
  return keyOrder.map((key, index) => {
    const existing = existingCitations.find((citation) => citation.key === key);
    const citation: CitationEntry = {
      index: index + 1,
      key,
      location: existing?.location || defaultLocation,
    };
    if (existing?.namedRangeIds) {
      citation.namedRangeIds = [...existing.namedRangeIds];
    }
    return citation;
  });
}
