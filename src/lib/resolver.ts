// ABOUTME: Resolves identifiers (DOI, PMID, arXiv, URL, title) to CSL-JSON.
// ABOUTME: Uses CrossRef, PubMed, arXiv, and Semantic Scholar APIs.

import type { CslJson, IdentifierType, ResolvedReference } from "../types/index.js";
import { generateCiteKey } from "./library.js";
import { fetchWithTimeout } from "./fetch-with-timeout.js";
import { parseName } from "./names.js";

/** Detect the type of identifier provided */
export function detectIdentifierType(input: string): IdentifierType {
  const trimmed = input.trim();

  // DOI patterns
  if (/^10\.\d{4,}\//.test(trimmed)) return "doi";
  if (/^https?:\/\/doi\.org\//.test(trimmed)) return "doi";
  if (/^doi:/.test(trimmed)) return "doi";

  // PubMed ID
  if (/^pmid:\d+$/i.test(trimmed)) return "pmid";

  // arXiv ID
  if (/^arxiv:\d{4}\.\d{4,}/i.test(trimmed)) return "arxiv";
  if (/^https?:\/\/arxiv\.org\/abs\//.test(trimmed)) return "arxiv";

  // URL
  if (/^https?:\/\//.test(trimmed)) return "url";

  // Free text (title search)
  return "title";
}

/** Normalize a DOI to its bare form (e.g. "10.1234/foo") */
export function normalizeDoi(input: string): string {
  let doi = input.trim();
  doi = doi.replace(/^doi:/i, "");
  doi = doi.replace(/^https?:\/\/doi\.org\//i, "");
  return doi;
}

/**
 * Return the set of canonical identifiers for a CSL entry, used for
 * deduplicating references across a scan batch. Covers DOI, PMID, arXiv id,
 * and a normalised URL so that the same paper referenced by different URL
 * forms (or an arXiv preprint with no DOI) maps to a single library entry.
 */
export function canonicalIds(csl: CslJson): string[] {
  const ids: string[] = [];
  if (csl.DOI) ids.push(`doi:${csl.DOI.toLowerCase()}`);
  if (csl.PMID) ids.push(`pmid:${csl.PMID}`);
  // csl.id is set to `arxiv:<id>` by resolveArxiv
  if (typeof csl.id === "string" && /^arxiv:/i.test(csl.id)) {
    ids.push(csl.id.toLowerCase().replace(/v\d+$/, ""));
  }
  if (csl.URL) {
    // Strip trailing slash + version suffix; lowercase scheme/host for stability.
    const u = csl.URL.trim()
      .replace(/\/$/, "")
      .replace(/^(https?:\/\/[^/]+)/i, (_, host) => host.toLowerCase());
    ids.push(`url:${u}`);
  }
  return ids;
}

/** Resolve a DOI via CrossRef content negotiation → CSL-JSON */
export async function resolveDoi(doi: string): Promise<CslJson> {
  const normalizedDoi = normalizeDoi(doi);
  const url = `https://api.crossref.org/works/${encodeURIComponent(normalizedDoi)}`;

  const resp = await fetchWithTimeout(url, {
    headers: { Accept: "application/json" },
  });

  if (!resp.ok) {
    throw new Error(
      `CrossRef lookup failed for DOI ${normalizedDoi}: ${resp.status} ${resp.statusText}`,
    );
  }

  const data = (await resp.json()) as any;
  const work = data.message;

  const csl: CslJson = {
    id: normalizedDoi,
    type: work.type || "article-journal",
    title: Array.isArray(work.title) ? work.title[0] : work.title,
    author: work.author?.map((a: any) => ({
      given: a.given,
      family: a.family,
    })),
    issued: work.issued || work["published-print"] || work["published-online"],
    "container-title": Array.isArray(work["container-title"])
      ? work["container-title"][0]
      : work["container-title"],
    volume: work.volume,
    issue: work.issue,
    page: work.page,
    DOI: normalizedDoi,
    URL: work.URL,
    publisher: work.publisher,
    ISSN: Array.isArray(work.ISSN) ? work.ISSN[0] : work.ISSN,
    abstract: work.abstract,
  };

  return csl;
}

/** Resolve a PubMed ID via NCBI E-utilities */
export async function resolvePmid(pmidInput: string): Promise<CslJson> {
  const pmid = pmidInput.replace(/^pmid:/i, "").trim();
  const url = `https://pmc.ncbi.nlm.nih.gov/api/ctxp/v1/pubmed/?format=csl&id=${pmid}`;

  const resp = await fetchWithTimeout(url);

  if (!resp.ok) {
    throw new Error(
      `PubMed lookup failed for PMID ${pmid}: ${resp.status} ${resp.statusText}`,
    );
  }

  const csl = (await resp.json()) as CslJson;
  csl.id = `pmid:${pmid}`;
  csl.PMID = pmid;
  return csl;
}

/** Resolve an arXiv ID via arXiv API */
export async function resolveArxiv(arxivInput: string): Promise<CslJson> {
  let arxivId = arxivInput.trim();
  arxivId = arxivId.replace(/^arxiv:/i, "");
  arxivId = arxivId.replace(/^https?:\/\/arxiv\.org\/abs\//i, "");
  arxivId = arxivId.replace(/v\d+$/, ""); // strip version

  const url = `https://export.arxiv.org/api/query?id_list=${arxivId}`;
  const resp = await fetchWithTimeout(url);

  if (!resp.ok) {
    throw new Error(
      `arXiv lookup failed for ${arxivId}: ${resp.status} ${resp.statusText}`,
    );
  }

  const xml = await resp.text();

  // Basic XML parsing for arXiv Atom feed
  const getTag = (tag: string, scope?: string): string => {
    const source = scope ?? xml;
    const match = source.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
    return match ? match[1].trim() : "";
  };

  // Extract from the <entry> block to avoid matching feed-level <title>
  const entryMatch = xml.match(/<entry>([\s\S]*?)<\/entry>/);
  const entry = entryMatch ? entryMatch[1] : xml;

  const title = getTag("title", entry).replace(/\n\s+/g, " ");
  const summary = getTag("summary", entry).replace(/\n\s+/g, " ");
  const published = getTag("published", entry);

  // Extract authors from entry scope
  const authorMatches = entry.matchAll(/<author>\s*<name>([^<]+)<\/name>/g);
  const authors: CslJson["author"] = [];
  for (const m of authorMatches) {
    authors.push(parseName(m[1]));
  }

  // Extract DOI if present (from entry scope)
  const doiMatch = entry.match(
    /<link[^>]*href="https?:\/\/dx\.doi\.org\/([^"]+)"/,
  );

  const year = published ? new Date(published).getFullYear() : undefined;

  const csl: CslJson = {
    id: `arxiv:${arxivId}`,
    type: "article",
    title,
    author: authors,
    issued: year ? { "date-parts": [[year]] } : undefined,
    abstract: summary,
    URL: `https://arxiv.org/abs/${arxivId}`,
    DOI: doiMatch ? doiMatch[1] : undefined,
  };

  return csl;
}

/** Search Semantic Scholar by title text, return top results */
export async function searchByTitle(
  query: string,
  limit: number = 5,
): Promise<CslJson[]> {
  const url = `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(query)}&limit=${limit}&fields=title,authors,year,externalIds,journal,abstract`;

  const maxAttempts = 4;
  let resp: Response | undefined;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    resp = await fetchWithTimeout(url);
    if (resp.status !== 429) break;
    // Drain the body to avoid connection/memory leaks
    await resp.text();
    if (attempt < maxAttempts - 1) {
      const delayMs = 1000 * 2 ** attempt;
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  if (!resp || !resp.ok) {
    const status = resp?.status ?? 0;
    const statusText = resp?.statusText ?? "Unknown";
    const msg = status === 429
      ? `Semantic Scholar rate limit exceeded after ${maxAttempts} attempts`
      : `Semantic Scholar search failed: ${status} ${statusText}`;
    throw new Error(msg);
  }

  const data = (await resp.json()) as any;
  if (!data.data || data.data.length === 0) {
    return [];
  }

  return data.data.map((paper: any) => {
    const csl: CslJson = {
      id: paper.externalIds?.DOI || paper.paperId,
      type: "article-journal",
      title: paper.title,
      author: paper.authors?.map((a: any) => parseName(a.name)),
      issued: paper.year ? { "date-parts": [[paper.year]] } : undefined,
      "container-title": paper.journal?.name,
      DOI: paper.externalIds?.DOI,
      PMID: paper.externalIds?.PubMed,
      URL: paper.externalIds?.DOI
        ? `https://doi.org/${paper.externalIds.DOI}`
        : `https://www.semanticscholar.org/paper/${paper.paperId}`,
      abstract: paper.abstract,
    };
    return csl;
  });
}

/** Main resolve function: detect type and resolve */
export async function resolve(
  input: string,
  existingKeys: string[],
): Promise<ResolvedReference> {
  const idType = detectIdentifierType(input);
  let csl: CslJson;

  switch (idType) {
    case "doi":
      csl = await resolveDoi(input);
      break;
    case "pmid":
      csl = await resolvePmid(input);
      break;
    case "arxiv":
      csl = await resolveArxiv(input);
      break;
    case "url":
      // Try to extract DOI from URL, fall back to title search
      const doiMatch = input.match(/10\.\d{4,}\/[^\s]+/);
      if (doiMatch) {
        csl = await resolveDoi(doiMatch[0]);
      } else {
        const results = await searchByTitle(input);
        if (results.length === 0) {
          throw new Error(`No results found for URL: ${input}`);
        }
        csl = results[0];
      }
      break;
    case "title":
      const titleResults = await searchByTitle(input);
      if (titleResults.length === 0) {
        throw new Error(`No results found for: ${input}`);
      }
      // Return first result; in interactive mode caller should present choices
      csl = titleResults[0];
      break;
  }

  const suggestedKey = generateCiteKey(csl, existingKeys);

  return {
    identifier: input,
    identifierType: idType,
    csl,
    suggestedKey,
  };
}
