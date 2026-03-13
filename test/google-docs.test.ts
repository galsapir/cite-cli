import { describe, it, expect } from "vitest";
import { findTextLocation, extractText, findParagraph, findCitationOccurrences, findAllCitationOccurrences, findCitationHyperlinks, findAcademicHyperlinks, isAcademicUrl } from "../src/lib/google-docs.js";
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

describe("findCitationOccurrences", () => {
  const namedRanges: Record<string, docs_v1.Schema$NamedRange[]> = {
    "cite:harris2020": [
      {
        namedRangeId: "nr1",
        name: "cite:harris2020",
        ranges: [{ startIndex: 10, endIndex: 13 }],
      },
      {
        namedRangeId: "nr2",
        name: "cite:harris2020",
        ranges: [{ startIndex: 50, endIndex: 53 }],
      },
    ],
    "cite:smith2021": [
      {
        namedRangeId: "nr3",
        name: "cite:smith2021",
        ranges: [{ startIndex: 30, endIndex: 33 }],
      },
    ],
    "cite-bibliography": [
      {
        namedRangeId: "bib1",
        name: "cite-bibliography",
        ranges: [{ startIndex: 100, endIndex: 200 }],
      },
    ],
  };

  it("finds all occurrences for a key", () => {
    const occs = findCitationOccurrences(namedRanges, "harris2020");
    expect(occs).toHaveLength(2);
    expect(occs[0]).toEqual({
      key: "harris2020",
      namedRangeId: "nr1",
      startIndex: 10,
      endIndex: 13,
    });
    expect(occs[1]).toEqual({
      key: "harris2020",
      namedRangeId: "nr2",
      startIndex: 50,
      endIndex: 53,
    });
  });

  it("returns empty array for unknown key", () => {
    expect(findCitationOccurrences(namedRanges, "unknown")).toEqual([]);
  });

  it("finds single occurrence", () => {
    const occs = findCitationOccurrences(namedRanges, "smith2021");
    expect(occs).toHaveLength(1);
    expect(occs[0].namedRangeId).toBe("nr3");
  });
});

describe("findCitationHyperlinks", () => {
  function makeLinkedDoc(links: Array<{ text: string; url: string }>): docs_v1.Schema$StructuralElement[] {
    let index = 1;
    const elements: docs_v1.Schema$ParagraphElement[] = links.map((link) => {
      const startIndex = index;
      const endIndex = startIndex + link.text.length;
      index = endIndex;
      return {
        startIndex,
        endIndex,
        textRun: {
          content: link.text,
          textStyle: { link: { url: link.url } },
        },
      };
    });

    return [{
      startIndex: 1,
      endIndex: index,
      paragraph: { elements },
    }];
  }

  it("finds citation hyperlinks matching our URL pattern", () => {
    const doc = makeLinkedDoc([
      { text: "[1]", url: "https://cite-cli.local/ref/harris2020" },
      { text: "[2]", url: "https://cite-cli.local/ref/smith2021" },
    ]);

    const links = findCitationHyperlinks(doc);
    expect(links).toHaveLength(2);
    expect(links[0].keys).toEqual(["harris2020"]);
    expect(links[1].keys).toEqual(["smith2021"]);
  });

  it("handles multi-key hyperlinks", () => {
    const doc = makeLinkedDoc([
      { text: "[1,2]", url: "https://cite-cli.local/ref/harris2020,smith2021" },
    ]);

    const links = findCitationHyperlinks(doc);
    expect(links).toHaveLength(1);
    expect(links[0].keys).toEqual(["harris2020", "smith2021"]);
  });

  it("ignores non-citation hyperlinks", () => {
    const doc = makeLinkedDoc([
      { text: "click here", url: "https://example.com" },
      { text: "[1]", url: "https://cite-cli.local/ref/harris2020" },
    ]);

    const links = findCitationHyperlinks(doc);
    expect(links).toHaveLength(1);
    expect(links[0].keys).toEqual(["harris2020"]);
  });

  it("returns empty for no hyperlinks", () => {
    const doc = makeDoc(["plain text"]);
    expect(findCitationHyperlinks(doc)).toEqual([]);
  });
});

describe("findAllCitationOccurrences", () => {
  it("finds all cite: ranges and ignores non-citation ranges", () => {
    const namedRanges: Record<string, docs_v1.Schema$NamedRange[]> = {
      "cite:a": [{ namedRangeId: "r1", name: "cite:a", ranges: [{ startIndex: 5, endIndex: 8 }] }],
      "cite:b": [{ namedRangeId: "r2", name: "cite:b", ranges: [{ startIndex: 20, endIndex: 23 }] }],
      "cite-bibliography": [{ namedRangeId: "bib", name: "cite-bibliography", ranges: [{ startIndex: 100, endIndex: 200 }] }],
    };

    const all = findAllCitationOccurrences(namedRanges);
    expect(all).toHaveLength(2);
    expect(all.map((o) => o.key).sort()).toEqual(["a", "b"]);
  });

  it("returns empty for no citation ranges", () => {
    expect(findAllCitationOccurrences({})).toEqual([]);
  });
});

describe("isAcademicUrl", () => {
  it("recognizes doi.org URLs", () => {
    expect(isAcademicUrl("https://doi.org/10.1038/s41586-020-2649-2")).toBe(true);
    expect(isAcademicUrl("https://dx.doi.org/10.1038/s41586-020-2649-2")).toBe(true);
    expect(isAcademicUrl("http://doi.org/10.1234/test")).toBe(true);
  });

  it("recognizes PubMed URLs", () => {
    expect(isAcademicUrl("https://pubmed.ncbi.nlm.nih.gov/29083404")).toBe(true);
    expect(isAcademicUrl("https://pubmed.ncbi.nlm.nih.gov/29083404/")).toBe(true);
  });

  it("recognizes arXiv URLs", () => {
    expect(isAcademicUrl("https://arxiv.org/abs/2303.08774")).toBe(true);
    expect(isAcademicUrl("http://arxiv.org/abs/2303.08774v2")).toBe(true);
  });

  it("recognizes URLs with embedded DOIs", () => {
    expect(isAcademicUrl("https://www.nature.com/articles/10.1038/s41586-020-2649-2")).toBe(true);
  });

  it("rejects non-academic URLs", () => {
    expect(isAcademicUrl("https://example.com")).toBe(false);
    expect(isAcademicUrl("https://google.com/search?q=test")).toBe(false);
  });

  it("rejects our own citation hyperlinks", () => {
    expect(isAcademicUrl("https://cite-cli.local/ref/harris2020")).toBe(false);
  });
});

describe("findAcademicHyperlinks", () => {
  function makeLinkedDoc(links: Array<{ text: string; url: string }>): docs_v1.Schema$StructuralElement[] {
    let index = 1;
    const elements: docs_v1.Schema$ParagraphElement[] = links.map((link) => {
      const startIndex = index;
      const endIndex = startIndex + link.text.length;
      index = endIndex;
      return {
        startIndex,
        endIndex,
        textRun: {
          content: link.text,
          textStyle: { link: { url: link.url } },
        },
      };
    });

    return [{
      startIndex: 1,
      endIndex: index,
      paragraph: { elements },
    }];
  }

  it("finds DOI hyperlinks", () => {
    const doc = makeLinkedDoc([
      { text: "ref", url: "https://doi.org/10.1038/s41586-020-2649-2" },
    ]);
    const links = findAcademicHyperlinks(doc);
    expect(links).toHaveLength(1);
    expect(links[0].url).toBe("https://doi.org/10.1038/s41586-020-2649-2");
    expect(links[0].text).toBe("ref");
    expect(links[0].startIndex).toBe(1);
    expect(links[0].endIndex).toBe(4);
  });

  it("finds PubMed and arXiv hyperlinks", () => {
    const doc = makeLinkedDoc([
      { text: "ref1", url: "https://pubmed.ncbi.nlm.nih.gov/29083404" },
      { text: "ref2", url: "https://arxiv.org/abs/2303.08774" },
    ]);
    const links = findAcademicHyperlinks(doc);
    expect(links).toHaveLength(2);
    expect(links[0].url).toContain("pubmed");
    expect(links[1].url).toContain("arxiv");
  });

  it("skips cite-cli.local hyperlinks", () => {
    const doc = makeLinkedDoc([
      { text: "[1]", url: "https://cite-cli.local/ref/harris2020" },
      { text: "ref", url: "https://doi.org/10.1038/s41586-020-2649-2" },
    ]);
    const links = findAcademicHyperlinks(doc);
    expect(links).toHaveLength(1);
    expect(links[0].text).toBe("ref");
  });

  it("skips non-academic hyperlinks", () => {
    const doc = makeLinkedDoc([
      { text: "click here", url: "https://example.com" },
      { text: "ref", url: "https://doi.org/10.1038/s41586-020-2649-2" },
    ]);
    const links = findAcademicHyperlinks(doc);
    expect(links).toHaveLength(1);
  });

  it("returns empty for plain text", () => {
    const doc = makeDoc(["plain text with no links"]);
    expect(findAcademicHyperlinks(doc)).toEqual([]);
  });

  it("handles mixed content with multiple academic links", () => {
    const doc = makeLinkedDoc([
      { text: "intro text", url: "https://example.com" },
      { text: "ref", url: "https://doi.org/10.1038/s41586-020-2649-2" },
      { text: "[1]", url: "https://cite-cli.local/ref/harris2020" },
      { text: "another ref", url: "https://pubmed.ncbi.nlm.nih.gov/12345" },
    ]);
    const links = findAcademicHyperlinks(doc);
    expect(links).toHaveLength(2);
    expect(links[0].text).toBe("ref");
    expect(links[1].text).toBe("another ref");
  });
});
