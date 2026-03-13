import { describe, it, expect } from "vitest";
import {
  sortRequestsReverseIndex,
  checkRevisionId,
  validateRequestBounds,
  validateNoOverlappingDeletes,
  validateBatchRequests,
  getBodyEndIndex,
} from "../src/lib/safety.js";
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

// Helper: build a minimal body with a known endIndex
function makeBody(endIndex: number): docs_v1.Schema$StructuralElement[] {
  return [
    { startIndex: 0, endIndex, paragraph: { elements: [] } },
  ];
}

describe("getBodyEndIndex", () => {
  it("returns endIndex of the last element", () => {
    expect(getBodyEndIndex(makeBody(500))).toBe(500);
  });

  it("returns 1 for an empty body", () => {
    expect(getBodyEndIndex([])).toBe(1);
  });

  it("handles multiple elements", () => {
    const body: docs_v1.Schema$StructuralElement[] = [
      { startIndex: 0, endIndex: 50, paragraph: { elements: [] } },
      { startIndex: 50, endIndex: 120, paragraph: { elements: [] } },
    ];
    expect(getBodyEndIndex(body)).toBe(120);
  });
});

describe("validateRequestBounds", () => {
  it("passes for valid insertText within bounds", () => {
    const requests: docs_v1.Schema$Request[] = [
      { insertText: { location: { index: 10 }, text: "hello" } },
    ];
    const result = validateRequestBounds(requests, 100);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("rejects insertText at index 0", () => {
    const requests: docs_v1.Schema$Request[] = [
      { insertText: { location: { index: 0 }, text: "x" } },
    ];
    const result = validateRequestBounds(requests, 100);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/below minimum/);
  });

  it("rejects insertText beyond document end", () => {
    const requests: docs_v1.Schema$Request[] = [
      { insertText: { location: { index: 100 }, text: "x" } },
    ];
    // bodyEndIndex=100, max valid insert is 99
    const result = validateRequestBounds(requests, 100);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/exceeds document end/);
  });

  it("accepts insertText at the last valid position", () => {
    const requests: docs_v1.Schema$Request[] = [
      { insertText: { location: { index: 99 }, text: "x" } },
    ];
    const result = validateRequestBounds(requests, 100);
    expect(result.valid).toBe(true);
  });

  it("rejects deleteContentRange with startIndex < 1", () => {
    const requests: docs_v1.Schema$Request[] = [
      { deleteContentRange: { range: { startIndex: 0, endIndex: 5 } } },
    ];
    const result = validateRequestBounds(requests, 100);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/below minimum/);
  });

  it("rejects deleteContentRange exceeding document end", () => {
    const requests: docs_v1.Schema$Request[] = [
      { deleteContentRange: { range: { startIndex: 50, endIndex: 200 } } },
    ];
    const result = validateRequestBounds(requests, 100);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/exceeds document end/);
  });

  it("rejects deleteContentRange where startIndex >= endIndex", () => {
    const requests: docs_v1.Schema$Request[] = [
      { deleteContentRange: { range: { startIndex: 50, endIndex: 50 } } },
    ];
    const result = validateRequestBounds(requests, 100);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/invalid range/);
  });

  it("reports insertText missing location.index", () => {
    const requests: docs_v1.Schema$Request[] = [
      { insertText: { text: "x" } },
    ];
    const result = validateRequestBounds(requests, 100);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/missing location\.index/);
  });

  it("skips structural requests (deleteNamedRange, createNamedRange, replaceAllText)", () => {
    const requests: docs_v1.Schema$Request[] = [
      { deleteNamedRange: { namedRangeId: "abc" } },
      { createNamedRange: { name: "bib", range: { startIndex: 1, endIndex: 10 } } },
      { replaceAllText: { containsText: { text: "old" }, replaceText: "new" } },
    ];
    const result = validateRequestBounds(requests, 100);
    expect(result.valid).toBe(true);
  });

  it("collects multiple errors", () => {
    const requests: docs_v1.Schema$Request[] = [
      { insertText: { location: { index: 0 }, text: "x" } },
      { deleteContentRange: { range: { startIndex: 50, endIndex: 200 } } },
    ];
    const result = validateRequestBounds(requests, 100);
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(2);
  });
});

describe("validateNoOverlappingDeletes", () => {
  it("passes when no deletes overlap", () => {
    const requests: docs_v1.Schema$Request[] = [
      { deleteContentRange: { range: { startIndex: 10, endIndex: 20 } } },
      { deleteContentRange: { range: { startIndex: 30, endIndex: 40 } } },
    ];
    const result = validateNoOverlappingDeletes(requests);
    expect(result.valid).toBe(true);
  });

  it("passes when deletes are adjacent (not overlapping)", () => {
    const requests: docs_v1.Schema$Request[] = [
      { deleteContentRange: { range: { startIndex: 10, endIndex: 20 } } },
      { deleteContentRange: { range: { startIndex: 20, endIndex: 30 } } },
    ];
    const result = validateNoOverlappingDeletes(requests);
    expect(result.valid).toBe(true);
  });

  it("rejects overlapping deletes", () => {
    const requests: docs_v1.Schema$Request[] = [
      { deleteContentRange: { range: { startIndex: 10, endIndex: 25 } } },
      { deleteContentRange: { range: { startIndex: 20, endIndex: 30 } } },
    ];
    const result = validateNoOverlappingDeletes(requests);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/Overlapping/);
  });

  it("rejects when one delete is fully contained in another", () => {
    const requests: docs_v1.Schema$Request[] = [
      { deleteContentRange: { range: { startIndex: 10, endIndex: 50 } } },
      { deleteContentRange: { range: { startIndex: 20, endIndex: 30 } } },
    ];
    const result = validateNoOverlappingDeletes(requests);
    expect(result.valid).toBe(false);
  });

  it("ignores non-delete requests", () => {
    const requests: docs_v1.Schema$Request[] = [
      { insertText: { location: { index: 15 }, text: "x" } },
      { deleteContentRange: { range: { startIndex: 10, endIndex: 20 } } },
    ];
    const result = validateNoOverlappingDeletes(requests);
    expect(result.valid).toBe(true);
  });

  it("passes with a single delete", () => {
    const requests: docs_v1.Schema$Request[] = [
      { deleteContentRange: { range: { startIndex: 10, endIndex: 20 } } },
    ];
    const result = validateNoOverlappingDeletes(requests);
    expect(result.valid).toBe(true);
  });
});

describe("validateBatchRequests", () => {
  it("throws on out-of-bounds insert", () => {
    const requests: docs_v1.Schema$Request[] = [
      { insertText: { location: { index: 500 }, text: "x" } },
    ];
    expect(() => validateBatchRequests(requests, makeBody(100))).toThrow(
      /Safety check failed/,
    );
  });

  it("throws on overlapping deletes", () => {
    const requests: docs_v1.Schema$Request[] = [
      { deleteContentRange: { range: { startIndex: 10, endIndex: 25 } } },
      { deleteContentRange: { range: { startIndex: 20, endIndex: 30 } } },
    ];
    expect(() => validateBatchRequests(requests, makeBody(100))).toThrow(
      /Safety check failed/,
    );
  });

  it("does not throw for valid requests", () => {
    const requests: docs_v1.Schema$Request[] = [
      { insertText: { location: { index: 50 }, text: "hello" } },
      { deleteContentRange: { range: { startIndex: 10, endIndex: 20 } } },
    ];
    expect(() => validateBatchRequests(requests, makeBody(100))).not.toThrow();
  });

  it("aggregates errors from bounds and overlap checks", () => {
    const requests: docs_v1.Schema$Request[] = [
      { insertText: { location: { index: 0 }, text: "x" } },
      { deleteContentRange: { range: { startIndex: 10, endIndex: 25 } } },
      { deleteContentRange: { range: { startIndex: 20, endIndex: 30 } } },
    ];
    expect(() => validateBatchRequests(requests, makeBody(100))).toThrow(
      /below minimum[\s\S]*Overlapping/,
    );
  });
});
