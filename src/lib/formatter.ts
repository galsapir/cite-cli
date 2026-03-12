import type { CslJson } from "../types/index.js";
import { formatAuthors, getYear } from "./format.js";

export type CitationStyle = "vancouver" | "apa" | "nature" | "ieee" | "chicago-author-date";

/** Format an inline citation marker */
export function formatInlineCitation(
  keys: string[],
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
  const authors = csl.author?.map((a) => {
    if (a.literal) return a.literal;
    const initials = a.given
      ? a.given
          .split(" ")
          .map((n) => n[0])
          .join("")
      : "";
    return `${a.family} ${initials}`;
  }).join(", ") || "Unknown";

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
  const authors = csl.author?.map((a) => {
    if (a.literal) return a.literal;
    const initials = a.given
      ? a.given
          .split(" ")
          .map((n) => `${n[0]}.`)
          .join(" ")
      : "";
    return `${a.family}, ${initials}`;
  }).join(", ") || "Unknown";

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
  const authors = csl.author?.map((a) => {
    if (a.literal) return a.literal;
    const initials = a.given
      ? a.given
          .split(" ")
          .map((n) => `${n[0]}.`)
          .join(" ")
      : "";
    return `${a.family}, ${initials}`;
  }).join(", ") || "Unknown";

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
  const authors = csl.author?.map((a) => {
    if (a.literal) return a.literal;
    const initials = a.given
      ? a.given
          .split(" ")
          .map((n) => `${n[0]}.`)
          .join(" ")
      : "";
    return `${initials} ${a.family}`;
  }).join(", ") || "Unknown";

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
  const authors = csl.author?.map((a) => {
    if (a.literal) return a.literal;
    return `${a.family}, ${a.given || ""}`;
  }).join(", ") || "Unknown";

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
