import { describe, it, expect } from "vitest";
import {
  detectIdentifierType,
  normalizeDoi,
} from "../src/lib/resolver.js";

describe("detectIdentifierType", () => {
  it("detects bare DOIs", () => {
    expect(detectIdentifierType("10.2337/dc19-1028")).toBe("doi");
  });

  it("detects DOI URLs", () => {
    expect(detectIdentifierType("https://doi.org/10.2337/dc19-1028")).toBe("doi");
  });

  it("detects doi: prefix", () => {
    expect(detectIdentifierType("doi:10.2337/dc19-1028")).toBe("doi");
  });

  it("detects PubMed IDs", () => {
    expect(detectIdentifierType("pmid:34791234")).toBe("pmid");
    expect(detectIdentifierType("PMID:34791234")).toBe("pmid");
  });

  it("detects arXiv IDs", () => {
    expect(detectIdentifierType("arxiv:2508.20148")).toBe("arxiv");
    expect(detectIdentifierType("https://arxiv.org/abs/2508.20148")).toBe("arxiv");
  });

  it("detects URLs", () => {
    expect(
      detectIdentifierType("https://www.nature.com/articles/s41467-025-67922-y"),
    ).toBe("url");
  });

  it("detects free text as title", () => {
    expect(
      detectIdentifierType("Interpreting glucose data from continuous glucose monitors"),
    ).toBe("title");
  });
});

describe("normalizeDoi", () => {
  it("strips doi: prefix", () => {
    expect(normalizeDoi("doi:10.2337/dc19-1028")).toBe("10.2337/dc19-1028");
  });

  it("strips doi.org URL", () => {
    expect(normalizeDoi("https://doi.org/10.2337/dc19-1028")).toBe("10.2337/dc19-1028");
  });

  it("returns bare DOI unchanged", () => {
    expect(normalizeDoi("10.2337/dc19-1028")).toBe("10.2337/dc19-1028");
  });
});
