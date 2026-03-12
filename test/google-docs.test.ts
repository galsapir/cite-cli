import { describe, it, expect } from "vitest";
import { findTextLocation, extractText, findParagraph } from "../src/lib/google-docs.js";
import type { docs_v1 } from "googleapis";

function makeDoc(paragraphs: string[]): docs_v1.Schema$StructuralElement[] {
  let index = 1; // Google Docs body starts at index 1
  return paragraphs.map((text) => {
    const startIndex = index;
    const endIndex = startIndex + text.length + 1; // +1 for newline
    index = endIndex;
    return {
      startIndex,
      endIndex,
      paragraph: {
        elements: [
          {
            startIndex,
            endIndex,
            textRun: { content: text + "\n" },
          },
        ],
      },
    } satisfies docs_v1.Schema$StructuralElement;
  });
}

describe("extractText", () => {
  it("extracts text from paragraphs", () => {
    const doc = makeDoc(["Hello world", "Second paragraph"]);
    expect(extractText(doc)).toBe("Hello world\nSecond paragraph\n");
  });
});

describe("findTextLocation", () => {
  it("finds text in document", () => {
    const doc = makeDoc(["Hello world", "international consensus on CGM"]);
    const loc = findTextLocation(doc, "international consensus");
    expect(loc).not.toBeNull();
    expect(loc!.text).toBe("international consensus");
    expect(loc!.paragraphIndex).toBe(1);
  });

  it("finds Nth occurrence", () => {
    const doc = makeDoc(["foo bar foo", "foo again"]);
    const loc1 = findTextLocation(doc, "foo", 1);
    const loc2 = findTextLocation(doc, "foo", 2);
    const loc3 = findTextLocation(doc, "foo", 3);

    expect(loc1).not.toBeNull();
    expect(loc2).not.toBeNull();
    expect(loc3).not.toBeNull();
    expect(loc1!.startIndex).not.toBe(loc2!.startIndex);
    expect(loc2!.startIndex).not.toBe(loc3!.startIndex);
  });

  it("returns null for missing text", () => {
    const doc = makeDoc(["Hello world"]);
    expect(findTextLocation(doc, "not here")).toBeNull();
  });
});

describe("findParagraph", () => {
  it("finds paragraph by number", () => {
    const doc = makeDoc(["First", "Second", "Third"]);
    const p = findParagraph(doc, 2);
    expect(p).not.toBeNull();
    expect(p!.startIndex).toBeGreaterThan(0);
  });

  it("returns null for out of range", () => {
    const doc = makeDoc(["Only one"]);
    expect(findParagraph(doc, 5)).toBeNull();
  });
});
