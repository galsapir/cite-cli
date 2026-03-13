// ABOUTME: Tests for Zotero collection resolution and item-to-collection mapping.
// ABOUTME: Validates name matching, disambiguation, and collection key extraction.

import { describe, it, expect } from "vitest";
import { matchCollections } from "../src/lib/zotero.js";

describe("matchCollections", () => {
  const collections = [
    { key: "ABC123", name: "pha-preprint", version: 1 },
    { key: "DEF456", name: "ml-papers", version: 1 },
    { key: "GHI789", name: "pha-final", version: 1 },
  ];

  it("returns exact match", () => {
    const matches = matchCollections(collections, "pha-preprint");
    expect(matches).toEqual([{ key: "ABC123", name: "pha-preprint", version: 1 }]);
  });

  it("returns empty array when no match", () => {
    const matches = matchCollections(collections, "nonexistent");
    expect(matches).toEqual([]);
  });

  it("matches case-insensitively", () => {
    const matches = matchCollections(collections, "PHA-Preprint");
    expect(matches).toEqual([{ key: "ABC123", name: "pha-preprint", version: 1 }]);
  });

  it("returns multiple partial matches", () => {
    const matches = matchCollections(collections, "pha");
    expect(matches).toHaveLength(2);
    expect(matches.map((c) => c.key)).toEqual(["ABC123", "GHI789"]);
  });

  it("prefers exact match over partial", () => {
    const withExact = [
      ...collections,
      { key: "JKL012", name: "pha", version: 1 },
    ];
    const matches = matchCollections(withExact, "pha");
    expect(matches).toEqual([{ key: "JKL012", name: "pha", version: 1 }]);
  });
});
