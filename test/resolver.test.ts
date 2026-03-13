import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  detectIdentifierType,
  normalizeDoi,
  resolvePmid,
  resolvePmcid,
  resolveArxiv,
  searchByTitle,
  canonicalIds,
  extractIdentifierFromUrl,
  scrapeMetaFromUrl,
  resolve,
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

describe("extractIdentifierFromUrl", () => {
  it("extracts PMID from PubMed URLs", () => {
    expect(extractIdentifierFromUrl("https://pubmed.ncbi.nlm.nih.gov/40665053/")).toEqual({
      type: "pmid",
      value: "40665053",
    });
    expect(extractIdentifierFromUrl("https://pubmed.ncbi.nlm.nih.gov/40665053")).toEqual({
      type: "pmid",
      value: "40665053",
    });
  });

  it("extracts PMCID from PMC URLs", () => {
    expect(extractIdentifierFromUrl("https://pmc.ncbi.nlm.nih.gov/articles/PMC12478425/")).toEqual({
      type: "pmcid",
      value: "PMC12478425",
    });
    expect(extractIdentifierFromUrl("https://pmc.ncbi.nlm.nih.gov/articles/PMC12478425")).toEqual({
      type: "pmcid",
      value: "PMC12478425",
    });
  });

  it("constructs DOI from Nature URLs", () => {
    expect(extractIdentifierFromUrl("https://www.nature.com/articles/s41467-025-67922-y")).toEqual({
      type: "doi",
      value: "10.1038/s41467-025-67922-y",
    });
    expect(extractIdentifierFromUrl("https://nature.com/articles/s41586-020-2649-2")).toEqual({
      type: "doi",
      value: "10.1038/s41586-020-2649-2",
    });
  });

  it("extracts embedded DOI from arbitrary URLs", () => {
    expect(extractIdentifierFromUrl("https://example.com/10.1234/foo-bar")).toEqual({
      type: "doi",
      value: "10.1234/foo-bar",
    });
  });

  it("returns null for URLs with no extractable identifier", () => {
    expect(extractIdentifierFromUrl("https://example.com/some-page")).toBeNull();
    expect(extractIdentifierFromUrl("https://www.anthropic.com/research/building-effective-agents")).toBeNull();
  });
});

// All resolver tests mock global fetch
const originalFetch = globalThis.fetch;

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.useRealTimers();
});

describe("scrapeMetaFromUrl", () => {
  it("extracts citation_doi from HTML meta tags", async () => {
    const html = `<html><head>
      <meta name="citation_doi" content="10.1038/s41467-025-67922-y">
      <meta name="citation_title" content="Some Paper Title">
    </head><body></body></html>`;
    vi.mocked(fetch).mockResolvedValueOnce(new Response(html, { status: 200 }));

    const result = await scrapeMetaFromUrl("https://example.com/paper");
    expect(result).toEqual({ doi: "10.1038/s41467-025-67922-y", title: "Some Paper Title" });
  });

  it("extracts only citation_title when no DOI meta tag", async () => {
    const html = `<html><head>
      <meta name="citation_title" content="Paper Without DOI">
    </head><body></body></html>`;
    vi.mocked(fetch).mockResolvedValueOnce(new Response(html, { status: 200 }));

    const result = await scrapeMetaFromUrl("https://example.com/paper");
    expect(result).toEqual({ doi: null, title: "Paper Without DOI" });
  });

  it("returns nulls when no citation meta tags found", async () => {
    const html = `<html><head><title>Blog Post</title></head><body></body></html>`;
    vi.mocked(fetch).mockResolvedValueOnce(new Response(html, { status: 200 }));

    const result = await scrapeMetaFromUrl("https://example.com/blog");
    expect(result).toEqual({ doi: null, title: null });
  });

  it("handles fetch errors gracefully", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error("network error"));

    const result = await scrapeMetaFromUrl("https://example.com/down");
    expect(result).toEqual({ doi: null, title: null });
  });

  it("handles non-200 responses gracefully", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(null, { status: 403, statusText: "Forbidden" }),
    );

    const result = await scrapeMetaFromUrl("https://example.com/forbidden");
    expect(result).toEqual({ doi: null, title: null });
  });

  it("handles DC.identifier DOI meta tag", async () => {
    const html = `<html><head>
      <meta name="DC.identifier" content="doi:10.1016/j.cell.2021.01.001">
    </head><body></body></html>`;
    vi.mocked(fetch).mockResolvedValueOnce(new Response(html, { status: 200 }));

    const result = await scrapeMetaFromUrl("https://example.com/paper");
    expect(result.doi).toBe("10.1016/j.cell.2021.01.001");
  });
});

describe("resolvePmid", () => {
  it("uses the new pmc.ncbi.nlm.nih.gov endpoint", async () => {
    const fakeCsl = { title: "Test", author: [] };
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify(fakeCsl), { status: 200 }),
    );

    await resolvePmid("pmid:12345678");

    const calledUrl = vi.mocked(fetch).mock.calls[0][0] as string;
    expect(calledUrl).toContain("pmc.ncbi.nlm.nih.gov");
    expect(calledUrl).not.toContain("api.ncbi.nlm.nih.gov");
  });
});

describe("resolvePmcid", () => {
  it("converts PMCID to PMID via NCBI API then resolves", async () => {
    // First call: NCBI ID converter returns PMID
    const converterXml = `<?xml version="1.0"?>
<pmcids status="ok">
  <record requested-id="PMC12478425" pmcid="PMC12478425" pmid="40665053" />
</pmcids>`;
    // Second call: PubMed CSL endpoint returns metadata
    const fakeCsl = { title: "Test Paper", author: [] };

    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(converterXml, { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(fakeCsl), { status: 200 }));

    const result = await resolvePmcid("PMC12478425");
    expect(result.title).toBe("Test Paper");

    // Verify first call was to NCBI converter
    const converterUrl = vi.mocked(fetch).mock.calls[0][0] as string;
    expect(converterUrl).toContain("idconv");
    expect(converterUrl).toContain("PMC12478425");

    // Verify second call was to PubMed CSL endpoint
    const pmidUrl = vi.mocked(fetch).mock.calls[1][0] as string;
    expect(pmidUrl).toContain("40665053");
  });

  it("throws when PMCID has no corresponding PMID", async () => {
    const converterXml = `<?xml version="1.0"?>
<pmcids status="ok">
  <record requested-id="PMC9999999" pmcid="PMC9999999" />
</pmcids>`;
    vi.mocked(fetch).mockResolvedValueOnce(new Response(converterXml, { status: 200 }));

    await expect(resolvePmcid("PMC9999999")).rejects.toThrow(/PMID/);
  });

  it("throws when NCBI converter returns error", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(null, { status: 500, statusText: "Internal Server Error" }),
    );
    await expect(resolvePmcid("PMC12478425")).rejects.toThrow(/NCBI/i);
  });
});

describe("resolveArxiv", () => {
  it("extracts the paper title, not the feed title", async () => {
    const arxivXml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>ArXiv Query: search_query=&amp;id_list=2303.08774</title>
  <entry>
    <title>GPT-4 Technical Report</title>
    <summary>We report the development of GPT-4.</summary>
    <published>2023-03-15T00:00:00Z</published>
    <author><name>OpenAI</name></author>
  </entry>
</feed>`;
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(arxivXml, { status: 200 }),
    );

    const result = await resolveArxiv("arxiv:2303.08774");
    expect(result.title).toBe("GPT-4 Technical Report");
    expect(result.title).not.toContain("ArXiv Query");
  });
});

describe("searchByTitle", () => {
  it("retries on 429 rate limit", async () => {
    vi.useFakeTimers();
    const rateLimitResp = new Response(null, { status: 429, statusText: "Too Many Requests" });
    const successResp = new Response(
      JSON.stringify({ data: [{ paperId: "abc", title: "Test Paper", authors: [], year: 2023 }] }),
      { status: 200 },
    );

    vi.mocked(fetch)
      .mockResolvedValueOnce(rateLimitResp)
      .mockResolvedValueOnce(successResp);

    const promise = searchByTitle("test query");
    await vi.advanceTimersByTimeAsync(1000);
    const results = await promise;
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe("Test Paper");
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
  });

  it("gives up after max attempts", async () => {
    vi.useFakeTimers();
    const rateLimitResp = new Response(null, { status: 429, statusText: "Too Many Requests" });
    vi.mocked(fetch)
      .mockResolvedValue(rateLimitResp);

    const promise = searchByTitle("test query").catch((e: Error) => e);
    await vi.advanceTimersByTimeAsync(10_000);
    const error = await promise;
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/rate limit/i);
  });
});

describe("resolve URL case", () => {
  it("resolves PubMed URLs via PMID extraction", async () => {
    const fakeCsl = { title: "PubMed Paper", author: [{ given: "A", family: "Smith" }] };
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify(fakeCsl), { status: 200 }),
    );

    const result = await resolve("https://pubmed.ncbi.nlm.nih.gov/40665053/", []);
    expect(result.csl.title).toBe("PubMed Paper");
    expect(result.identifierType).toBe("url");

    // Should have called PubMed CSL endpoint with extracted PMID
    const calledUrl = vi.mocked(fetch).mock.calls[0][0] as string;
    expect(calledUrl).toContain("40665053");
  });

  it("resolves PMC URLs via PMCID→PMID conversion", async () => {
    const converterXml = `<?xml version="1.0"?>
<pmcids status="ok">
  <record requested-id="PMC12478425" pmcid="PMC12478425" pmid="40665053" />
</pmcids>`;
    const fakeCsl = { title: "PMC Paper", author: [] };

    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(converterXml, { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(fakeCsl), { status: 200 }));

    const result = await resolve("https://pmc.ncbi.nlm.nih.gov/articles/PMC12478425/", []);
    expect(result.csl.title).toBe("PMC Paper");
  });

  it("resolves Nature URLs via constructed DOI", async () => {
    const crossrefData = {
      message: {
        type: "article-journal",
        title: ["Nature Paper"],
        DOI: "10.1038/s41467-025-67922-y",
        author: [{ given: "A", family: "Author" }],
      },
    };
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify(crossrefData), { status: 200 }),
    );

    const result = await resolve("https://www.nature.com/articles/s41467-025-67922-y", []);
    expect(result.csl.title).toBe("Nature Paper");

    const calledUrl = vi.mocked(fetch).mock.calls[0][0] as string;
    expect(calledUrl).toContain("10.1038");
  });

  it("falls back to HTML meta scraping when no pattern matches", async () => {
    // First call: scrape HTML → find citation_doi
    const html = `<html><head>
      <meta name="citation_doi" content="10.1016/j.cell.2021.01.001">
    </head></html>`;
    // Second call: resolve DOI via CrossRef
    const crossrefData = {
      message: {
        type: "article-journal",
        title: ["Cell Paper"],
        DOI: "10.1016/j.cell.2021.01.001",
      },
    };

    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(html, { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(crossrefData), { status: 200 }));

    const result = await resolve("https://www.cell.com/some-article", []);
    expect(result.csl.title).toBe("Cell Paper");
  });

  it("falls back to Semantic Scholar with scraped title when only title found", async () => {
    // First call: scrape HTML → find citation_title but no DOI
    const html = `<html><head>
      <meta name="citation_title" content="Scraped Paper Title">
    </head></html>`;
    // Second call: Semantic Scholar search
    const ssData = {
      data: [{ paperId: "abc", title: "Scraped Paper Title", authors: [], year: 2024 }],
    };

    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(html, { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(ssData), { status: 200 }));

    const result = await resolve("https://unknown-publisher.com/paper", []);
    expect(result.csl.title).toBe("Scraped Paper Title");
  });

  it("falls back to Semantic Scholar with raw URL as last resort", async () => {
    // First call: scrape HTML → no meta tags
    const html = `<html><head><title>Blog</title></head></html>`;
    // Second call: Semantic Scholar search
    const ssData = {
      data: [{ paperId: "xyz", title: "Some Result", authors: [], year: 2023 }],
    };

    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(html, { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(ssData), { status: 200 }));

    const result = await resolve("https://unknown.com/something", []);
    expect(result.csl.title).toBe("Some Result");
  });
});

describe("resolveDoi error handling", () => {
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

describe("canonicalIds", () => {
  it("returns DOI, PMID, arXiv id, and URL identifiers", () => {
    const ids = canonicalIds({
      id: "arxiv:2508.20148",
      type: "article",
      title: "t",
      DOI: "10.1234/abc",
      PMID: "31177185",
      URL: "https://arxiv.org/abs/2508.20148",
    });
    expect(ids).toContain("doi:10.1234/abc");
    expect(ids).toContain("pmid:31177185");
    expect(ids).toContain("arxiv:2508.20148");
    expect(ids).toContain("url:https://arxiv.org/abs/2508.20148");
  });

  it("lowercases and normalises URLs + DOIs for stable dedup", () => {
    const a = canonicalIds({ id: "x", type: "article", title: "t", DOI: "10.1234/AbC", URL: "HTTPS://Arxiv.ORG/abs/2508.20148/" });
    const b = canonicalIds({ id: "y", type: "article", title: "t", DOI: "10.1234/abc", URL: "https://arxiv.org/abs/2508.20148" });
    expect(a).toEqual(b);
  });

  it("strips arXiv version suffix from id", () => {
    const ids = canonicalIds({ id: "arxiv:2508.20148v3", type: "article", title: "t" });
    expect(ids).toContain("arxiv:2508.20148");
  });

  it("returns an empty list when no identifiers are present", () => {
    expect(canonicalIds({ id: "local:1", type: "article", title: "t" })).toEqual([]);
  });
});
