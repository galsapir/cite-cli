import chalk from "chalk";
import type { CslJson, LibraryEntry } from "../types/index.js";

/** Format a single CSL-JSON reference for terminal display */
export function formatReference(csl: CslJson, key?: string): string {
  const authors = formatAuthors(csl.author);
  const year = getYear(csl);
  const title = csl.title || "Untitled";
  const journal = csl["container-title"] || "";

  const parts: string[] = [];
  if (key) {
    parts.push(chalk.cyan(`[${key}]`));
  }
  parts.push(`${authors} (${year})`);
  parts.push(chalk.white(`"${title}"`));
  if (journal) {
    parts.push(chalk.dim(journal));
  }
  if (csl.DOI) {
    parts.push(chalk.dim(`DOI: ${csl.DOI}`));
  }

  return parts.join("  ");
}

/** Format a library entry for terminal display */
export function formatLibraryEntry(entry: LibraryEntry): string {
  return formatReference(entry.csl, entry.key);
}

/** Format author list */
export function formatAuthors(
  authors?: CslJson["author"],
): string {
  if (!authors || authors.length === 0) return "Unknown";

  const first = authors[0];
  const name = first.family || first.literal || "Unknown";

  if (authors.length === 1) return name;
  if (authors.length === 2) {
    const second = authors[1];
    return `${name} & ${second.family || second.literal}`;
  }
  return `${name} et al.`;
}

/** Get year from CSL-JSON */
export function getYear(csl: CslJson): string {
  if (csl.issued?.["date-parts"]?.[0]?.[0]) {
    return csl.issued["date-parts"][0][0].toString();
  }
  if (csl.issued?.raw) {
    const match = csl.issued.raw.match(/(\d{4})/);
    if (match) return match[1];
  }
  return "n.d.";
}
