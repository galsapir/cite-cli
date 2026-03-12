import { describe, it, expect } from "vitest";
import { sortRequestsReverseIndex, checkRevisionId } from "../src/lib/safety.js";
import type { docs_v1 } from "googleapis";

describe("sortRequestsReverseIndex", () => {
  it("sorts insertText requests by index descending", () => {
    const requests: docs_v1.Schema$Request[] = [
      { insertText: { location: { index: 100 }, text: "a" } },
      { insertText: { location: { index: 500 }, text: "b" } },
      { insertText: { location: { index: 250 }, text: "c" } },
    ];

    const sorted = sortRequestsReverseIndex(requests);
    expect(sorted[0].insertText?.location?.index).toBe(500);
    expect(sorted[1].insertText?.location?.index).toBe(250);
    expect(sorted[2].insertText?.location?.index).toBe(100);
  });

  it("handles mixed request types", () => {
    const requests: docs_v1.Schema$Request[] = [
      { insertText: { location: { index: 100 }, text: "a" } },
      { deleteContentRange: { range: { startIndex: 300, endIndex: 350 } } },
      { insertText: { location: { index: 200 }, text: "b" } },
    ];

    const sorted = sortRequestsReverseIndex(requests);
    expect(sorted[0]).toHaveProperty("deleteContentRange");
  });
});

describe("checkRevisionId", () => {
  it("returns true when IDs match", () => {
    expect(checkRevisionId("abc123", "abc123")).toBe(true);
  });

  it("returns false when IDs differ", () => {
    expect(checkRevisionId("abc123", "xyz789")).toBe(false);
  });

  it("returns true when either ID is empty (can't check)", () => {
    expect(checkRevisionId("", "abc")).toBe(true);
    expect(checkRevisionId("abc", "")).toBe(true);
  });
});
