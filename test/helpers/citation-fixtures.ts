// ABOUTME: Tiny fixture builders for citation/library test data.
// ABOUTME: Lets test files seed minimally-valid CitationEntry and LibraryEntry objects.

import type { CitationEntry, CslJson, LibraryEntry } from "../../src/types/index.js";

export function citation(index: number, key: string, location = "test"): CitationEntry {
  return { index, key, location };
}

export function entry(key: string, overrides: Partial<CslJson> = {}): LibraryEntry {
  return {
    key,
    addedAt: "2026-01-01T00:00:00.000Z",
    csl: {
      id: key,
      type: "article-journal",
      title: `Paper ${key}`,
      author: [{ given: "Alice", family: "Adams" }],
      issued: { "date-parts": [[2020]] },
      ...overrides,
    },
  };
}
