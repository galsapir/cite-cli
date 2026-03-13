import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  detectIdentifierType,
  normalizeDoi,
  resolvePmid,
  resolveArxiv,
  searchByTitle,
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

// All resolver tests mock global fetch
const originalFetch = globalThis.fetch;

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.useRealTimers();
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
