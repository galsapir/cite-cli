// ABOUTME: Parsers for BibTeX and RIS citation formats.
// ABOUTME: Converts entries to CSL-JSON for storage in the local library.

import type { CslJson } from "../types/index.js";

/**
 * Simple BibTeX parser that converts entries to CSL-JSON.
 * Handles the most common entry types and fields.
 */
export function parseBibtex(bibtex: string): CslJson[] {
  const entries: CslJson[] = [];
  // Match @type{key, ... } blocks
  const entryRegex = /@(\w+)\s*\{([^,]+),\s*([\s\S]*?)(?=\n@|\n*$)/g;
  let match;

  while ((match = entryRegex.exec(bibtex)) !== null) {
    const type = match[1].toLowerCase();
    const key = match[2].trim();
    const body = match[3];

    if (type === "string" || type === "preamble" || type === "comment") continue;

    const fields = parseFields(body);
    const csl = fieldsToCsl(type, key, fields);
    entries.push(csl);
  }

  return entries;
}

function parseFields(body: string): Record<string, string> {
  const fields: Record<string, string> = {};
  // Match field = {value} or field = "value" or field = number
  const fieldRegex = /(\w+)\s*=\s*(?:\{((?:[^{}]|\{[^{}]*\})*)\}|"([^"]*)"|(\d+))/g;
  let match;

  while ((match = fieldRegex.exec(body)) !== null) {
    const name = match[1].toLowerCase();
    const value = (match[2] ?? match[3] ?? match[4] ?? "").trim();
    fields[name] = cleanLatex(value);
  }

  return fields;
}

function cleanLatex(text: string): string {
  return text
    .replace(/\{\\['"^`~](.)\}/g, "$1") // accented chars
    .replace(/\\['"^`~](.)/g, "$1")
    .replace(/[{}]/g, "")
    .replace(/\\\\/g, "")
    .replace(/~/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseAuthors(authorStr: string): CslJson["author"] {
  if (!authorStr) return [];
  return authorStr.split(/\s+and\s+/i).map((name) => {
    name = name.trim();
    if (name.includes(",")) {
      const [family, given] = name.split(",").map((s) => s.trim());
      return { family, given };
    }
    const parts = name.split(" ");
    const family = parts.pop() || "";
    const given = parts.join(" ");
    return { given, family };
  });
}

function fieldsToCsl(
  type: string,
  key: string,
  fields: Record<string, string>,
): CslJson {
  const typeMap: Record<string, string> = {
    article: "article-journal",
    inproceedings: "paper-conference",
    conference: "paper-conference",
    book: "book",
    incollection: "chapter",
    inbook: "chapter",
    phdthesis: "thesis",
    mastersthesis: "thesis",
    techreport: "report",
    misc: "article",
    unpublished: "manuscript",
  };

  const parsedYear = fields.year ? parseInt(fields.year, 10) : NaN;
  const year = Number.isNaN(parsedYear) ? undefined : parsedYear;

  const csl: CslJson = {
    id: key,
    type: typeMap[type] || "article",
    title: fields.title,
    author: parseAuthors(fields.author || ""),
    issued: year ? { "date-parts": [[year]] } : undefined,
    "container-title": fields.journal || fields.booktitle,
    volume: fields.volume,
    issue: fields.number,
    page: fields.pages?.replace("--", "-"),
    DOI: fields.doi,
    URL: fields.url,
    publisher: fields.publisher,
    abstract: fields.abstract,
    ISBN: fields.isbn,
    ISSN: fields.issn,
  };

  return csl;
}

/**
 * Simple RIS parser that converts entries to CSL-JSON.
 */
export function parseRis(ris: string): CslJson[] {
  const entries: CslJson[] = [];
  const blocks = ris.split(/\nER\s*-/).filter((b) => b.trim());

  for (const block of blocks) {
    const fields = new Map<string, string[]>();
    const lines = block.split("\n");

    for (const line of lines) {
      const match = line.match(/^([A-Z][A-Z0-9])\s*-\s*(.*)/);
      if (match) {
        const tag = match[1];
        const value = match[2].trim();
        if (!fields.has(tag)) fields.set(tag, []);
        fields.get(tag)!.push(value);
      }
    }

    if (fields.size === 0) continue;

    const typeMap: Record<string, string> = {
      JOUR: "article-journal",
      BOOK: "book",
      CHAP: "chapter",
      CONF: "paper-conference",
      THES: "thesis",
      RPRT: "report",
      GEN: "article",
    };

    const risType = fields.get("TY")?.[0] || "GEN";
    const authors = (fields.get("AU") || fields.get("A1") || []).map((name) => {
      if (name.includes(",")) {
        const [family, given] = name.split(",").map((s) => s.trim());
        return { family, given };
      }
      const parts = name.split(" ");
      const family = parts.pop() || "";
      const given = parts.join(" ");
      return { given, family };
    });

    const year = fields.get("PY")?.[0] || fields.get("Y1")?.[0];
    const parsedYearNum = year ? parseInt(year, 10) : NaN;
    const yearNum = Number.isNaN(parsedYearNum) ? undefined : parsedYearNum;

    const csl: CslJson = {
      id: fields.get("ID")?.[0] || fields.get("DO")?.[0] || `ris-${entries.length}`,
      type: typeMap[risType] || "article",
      title: fields.get("TI")?.[0] || fields.get("T1")?.[0],
      author: authors,
      issued: yearNum ? { "date-parts": [[yearNum]] } : undefined,
      "container-title": fields.get("JO")?.[0] || fields.get("T2")?.[0] || fields.get("JF")?.[0],
      volume: fields.get("VL")?.[0],
      issue: fields.get("IS")?.[0],
      page: fields.get("SP")?.[0]
        ? `${fields.get("SP")![0]}${fields.get("EP")?.[0] ? `-${fields.get("EP")![0]}` : ""}`
        : undefined,
      DOI: fields.get("DO")?.[0],
      URL: fields.get("UR")?.[0],
      abstract: fields.get("AB")?.[0],
      publisher: fields.get("PB")?.[0],
    };

    entries.push(csl);
  }

  return entries;
}
