// ABOUTME: Citation style formatter for inline markers and bibliography entries.
// ABOUTME: Supports Vancouver, APA, Nature, IEEE, and Chicago styles.

import type { CslJson, CitationStyle } from "../types/index.js";
import { formatAuthors, getYear } from "./format.js";

export type { CitationStyle };

/** Format an inline citation marker */
export function formatInlineCitation(
  indices: number[],
  style: CitationStyle,
  cslEntries: CslJson[],
): string {
  switch (style) {
    case "vancouver":
    case "ieee":
      // Numbered: [1], [1,2,3], or [1-3]
      return formatNumberedCitation(indices);

    case "nature":
      // Nature uses superscript numbers, but in plain text we use [N]
      return formatNumberedCitation(indices);

    case "apa":
    case "chicago-author-date":
      // Author-year: (Author, Year) or (Author1, 2019; Author2, 2021)
      return formatAuthorYearCitation(cslEntries);

    default:
      return formatNumberedCitation(indices);
  }
}

function formatNumberedCitation(indices: number[]): string {
  if (indices.length === 0) return "";
  if (indices.length === 1) return `[${indices[0]}]`;

  const sorted = [...indices].sort((a, b) => a - b);

  // Check if consecutive for range notation
  const isConsecutive = sorted.every(
    (val, i) => i === 0 || val === sorted[i - 1] + 1,
  );

  if (isConsecutive && sorted.length >= 3) {
    return `[${sorted[0]}-${sorted[sorted.length - 1]}]`;
  }

  return `[${sorted.join(",")}]`;
}

function formatAuthorYearCitation(entries: CslJson[]): string {
  if (entries.length === 0) return "";
  if (entries.length === 1) {
    const e = entries[0];
    return `(${formatAuthors(e.author)}, ${getYear(e)})`;
  }

  const parts = entries.map((e) => `${formatAuthors(e.author)}, ${getYear(e)}`);
  return `(${parts.join("; ")})`;
}

type InitialsFormat =
  | "compact"       // "AB" — Vancouver
  | "dotted"        // "A. B." — APA, Nature
  | "dotted-first"  // "A. B. Family" — IEEE (initials before family)
  | "full";         // full given name — Chicago

function formatBibAuthorList(
  authors: CslJson["author"],
  format: InitialsFormat,
): string {
  if (!authors || authors.length === 0) return "Unknown";

  return authors.map((a) => {
    if (a.literal) return a.literal;
    const given = a.given || "";
    const family = a.family || "";

    switch (format) {
      case "compact": {
        const initials = given.split(" ").map((n) => n[0]).join("");
        return `${family} ${initials}`;
      }
      case "dotted": {
        const initials = given.split(" ").map((n) => `${n[0]}.`).join(" ");
        return `${family}, ${initials}`;
      }
      case "dotted-first": {
        const initials = given.split(" ").map((n) => `${n[0]}.`).join(" ");
        return `${initials} ${family}`;
      }
      case "full":
        return `${family}, ${given}`;
    }
  }).join(", ");
}

/** Format a bibliography entry */
export function formatBibEntry(
  index: number,
  csl: CslJson,
  style: CitationStyle,
): string {
  switch (style) {
    case "vancouver":
      return formatVancouverEntry(index, csl);
    case "apa":
      return formatApaEntry(csl);
    case "nature":
      return formatNatureEntry(index, csl);
    case "ieee":
      return formatIeeeEntry(index, csl);
    case "chicago-author-date":
      return formatChicagoEntry(csl);
    default:
      return formatVancouverEntry(index, csl);
  }
}

function formatVancouverEntry(index: number, csl: CslJson): string {
  const authors = formatBibAuthorList(csl.author, "compact");

  const title = csl.title || "Untitled";
  const journal = csl["container-title"] || "";
  const year = getYear(csl);
  const vol = csl.volume ? `;${csl.volume}` : "";
  const issue = csl.issue ? `(${csl.issue})` : "";
  const pages = csl.page ? `:${csl.page}` : "";

  let entry = `${index}. ${authors}. ${title}.`;
  if (journal) entry += ` ${journal}. ${year}${vol}${issue}${pages}.`;
  else entry += ` ${year}.`;

  if (csl.DOI) entry += ` doi:${csl.DOI}`;
  return entry;
}

function formatApaEntry(csl: CslJson): string {
  const authors = formatBibAuthorList(csl.author, "dotted");

  const year = getYear(csl);
  const title = csl.title || "Untitled";
  const journal = csl["container-title"] || "";
  const vol = csl.volume || "";
  const issue = csl.issue ? `(${csl.issue})` : "";
  const pages = csl.page || "";

  let entry = `${authors} (${year}). ${title}.`;
  if (journal) {
    entry += ` ${journal}`;
    if (vol) entry += `, ${vol}${issue}`;
    if (pages) entry += `, ${pages}`;
    entry += ".";
  }
  if (csl.DOI) entry += ` https://doi.org/${csl.DOI}`;
  return entry;
}

function formatNatureEntry(index: number, csl: CslJson): string {
  const authors = formatBibAuthorList(csl.author, "dotted");

  const title = csl.title || "Untitled";
  const journal = csl["container-title"] || "";
  const vol = csl.volume ? ` ${csl.volume}` : "";
  const pages = csl.page ? `, ${csl.page}` : "";
  const year = getYear(csl);

  let entry = `${index}. ${authors} ${title}.`;
  if (journal) entry += ` ${journal}${vol}${pages} (${year}).`;
  else entry += ` (${year}).`;
  return entry;
}

function formatIeeeEntry(index: number, csl: CslJson): string {
  const authors = formatBibAuthorList(csl.author, "dotted-first");

  const title = csl.title || "Untitled";
  const journal = csl["container-title"] || "";
  const vol = csl.volume ? `, vol. ${csl.volume}` : "";
  const issue = csl.issue ? `, no. ${csl.issue}` : "";
  const pages = csl.page ? `, pp. ${csl.page}` : "";
  const year = getYear(csl);

  let entry = `[${index}] ${authors}, "${title},"`;
  if (journal) entry += ` ${journal}${vol}${issue}${pages}, ${year}.`;
  else entry += ` ${year}.`;
  return entry;
}

function formatChicagoEntry(csl: CslJson): string {
  const authors = formatBibAuthorList(csl.author, "full");

  const year = getYear(csl);
  const title = csl.title || "Untitled";
  const journal = csl["container-title"] || "";
  const vol = csl.volume || "";
  const issue = csl.issue ? `, no. ${csl.issue}` : "";
  const pages = csl.page ? `: ${csl.page}` : "";

  let entry = `${authors}. ${year}. "${title}."`;
  if (journal) entry += ` ${journal} ${vol}${issue}${pages}.`;
  if (csl.DOI) entry += ` https://doi.org/${csl.DOI}.`;
  return entry;
}
