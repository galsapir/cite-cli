import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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

describe("resolveDoi error handling", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("throws on non-OK response", async () => {
    const { resolveDoi } = await import("../src/lib/resolver.js");
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(null, { status: 404, statusText: "Not Found" }),
    );
    await expect(resolveDoi("10.1234/fake")).rejects.toThrow("CrossRef lookup failed");
  });

  it("wraps malformed JSON with a descriptive error", async () => {
    const { resolveDoi } = await import("../src/lib/resolver.js");
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response("not json", { status: 200 }),
    );
    await expect(resolveDoi("10.1234/fake")).rejects.toThrow(/parse|json|unexpected/i);
  });
});
