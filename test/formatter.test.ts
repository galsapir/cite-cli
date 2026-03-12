import { describe, it, expect } from "vitest";
import { formatInlineCitation, formatBibEntry } from "../src/lib/formatter.js";
import type { CslJson } from "../src/types/index.js";

const sampleCsl: CslJson = {
  id: "10.2337/dc19-1028",
  type: "article-journal",
  title: "Clinical Targets for Continuous Glucose Monitoring",
  author: [
    { given: "Tadej", family: "Battelino" },
    { given: "Thomas", family: "Danne" },
  ],
  issued: { "date-parts": [[2019]] },
  "container-title": "Diabetes Care",
  volume: "42",
  issue: "8",
  page: "1593-1603",
  DOI: "10.2337/dc19-1028",
};

describe("formatInlineCitation", () => {
  it("formats single numbered citation (vancouver)", () => {
    expect(formatInlineCitation(["key1"], [1], "vancouver", [sampleCsl])).toBe("[1]");
  });

  it("formats multiple numbered citations", () => {
    expect(formatInlineCitation(["k1", "k2", "k3"], [1, 2, 3], "vancouver", [])).toBe("[1-3]");
  });

  it("formats non-consecutive numbered citations", () => {
    expect(formatInlineCitation(["k1", "k2"], [1, 3], "vancouver", [])).toBe("[1,3]");
  });

  it("formats APA author-year", () => {
    const result = formatInlineCitation(["k1"], [1], "apa", [sampleCsl]);
    expect(result).toContain("Battelino");
    expect(result).toContain("2019");
  });

  it("formats multiple APA citations", () => {
    const csl2: CslJson = {
      ...sampleCsl,
      author: [{ given: "Steven", family: "Broll" }],
      issued: { "date-parts": [[2021]] },
    };
    const result = formatInlineCitation(["k1", "k2"], [1, 2], "apa", [sampleCsl, csl2]);
    expect(result).toContain(";");
    expect(result).toContain("Battelino");
    expect(result).toContain("Broll");
  });
});

describe("formatBibEntry", () => {
  it("formats Vancouver entry", () => {
    const entry = formatBibEntry(1, sampleCsl, "vancouver");
    expect(entry).toContain("1.");
    expect(entry).toContain("Battelino");
    expect(entry).toContain("Diabetes Care");
    expect(entry).toContain("2019");
  });

  it("formats APA entry", () => {
    const entry = formatBibEntry(1, sampleCsl, "apa");
    expect(entry).toContain("Battelino");
    expect(entry).toContain("(2019)");
    expect(entry).toContain("doi.org");
  });

  it("formats Nature entry", () => {
    const entry = formatBibEntry(1, sampleCsl, "nature");
    expect(entry).toContain("1.");
    expect(entry).toContain("Battelino");
    expect(entry).toContain("(2019)");
  });

  it("formats IEEE entry", () => {
    const entry = formatBibEntry(1, sampleCsl, "ieee");
    expect(entry).toContain("[1]");
    expect(entry).toContain("Battelino");
    expect(entry).toContain("vol. 42");
  });

  it("formats Chicago entry", () => {
    const entry = formatBibEntry(1, sampleCsl, "chicago-author-date");
    expect(entry).toContain("Battelino");
    expect(entry).toContain("2019");
    expect(entry).toContain("doi.org");
  });
});
