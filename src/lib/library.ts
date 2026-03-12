// ABOUTME: Local citation library stored as JSON in ~/.cite/libraries/.
// ABOUTME: Handles CRUD operations, search, and cite-key generation.

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getCiteDir } from "./config.js";
import type { LibraryEntry, CslJson } from "../types/index.js";
import { getYear } from "./format.js";

function libraryPath(libraryId: string): string {
  const safeId = libraryId.replace(/\//g, "-");
  return join(getCiteDir(), "libraries", `${safeId}.json`);
}

export async function loadLibrary(libraryId: string): Promise<LibraryEntry[]> {
  const path = libraryPath(libraryId);
  try {
    const raw = await readFile(path, "utf-8");
    return JSON.parse(raw) as LibraryEntry[];
  } catch (err: any) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
}

export async function saveLibrary(
  libraryId: string,
  entries: LibraryEntry[],
): Promise<void> {
  const path = libraryPath(libraryId);
  await writeFile(path, JSON.stringify(entries, null, 2), "utf-8");
}

export async function addToLibrary(
  libraryId: string,
  entry: LibraryEntry,
): Promise<LibraryEntry[]> {
  const entries = await loadLibrary(libraryId);
  const existing = entries.findIndex((e) => e.key === entry.key);
  if (existing >= 0) {
    entries[existing] = entry;
  } else {
    entries.push(entry);
  }
  await saveLibrary(libraryId, entries);
  return entries;
}

export async function findInLibrary(
  libraryId: string,
  query: string,
): Promise<LibraryEntry[]> {
  const entries = await loadLibrary(libraryId);
  const q = query.toLowerCase();
  return entries.filter((entry) => {
    const titleMatch = entry.csl.title?.toLowerCase().includes(q);
    const keyMatch = entry.key.toLowerCase().includes(q);
    const authorMatch = entry.csl.author?.some(
      (a) =>
        a.family?.toLowerCase().includes(q) ||
        a.given?.toLowerCase().includes(q) ||
        a.literal?.toLowerCase().includes(q),
    );
    const tagMatch = entry.tags?.some((t) => t.toLowerCase().includes(q));
    return titleMatch || keyMatch || authorMatch || tagMatch;
  });
}

export async function searchLibrary(
  libraryId: string,
  opts: { author?: string; year?: string; tag?: string; query?: string },
): Promise<LibraryEntry[]> {
  const entries = await loadLibrary(libraryId);
  return entries.filter((entry) => {
    if (opts.author) {
      const a = opts.author.toLowerCase();
      const hasAuthor = entry.csl.author?.some(
        (auth) =>
          auth.family?.toLowerCase().includes(a) ||
          auth.given?.toLowerCase().includes(a) ||
          auth.literal?.toLowerCase().includes(a),
      );
      if (!hasAuthor) return false;
    }
    if (opts.year) {
      const year = getYear(entry.csl);
      if (year !== opts.year) return false;
    }
    if (opts.tag) {
      const t = opts.tag.toLowerCase();
      if (!entry.tags?.some((tag) => tag.toLowerCase().includes(t)))
        return false;
    }
    if (opts.query) {
      const q = opts.query.toLowerCase();
      const titleMatch = entry.csl.title?.toLowerCase().includes(q);
      const keyMatch = entry.key.toLowerCase().includes(q);
      if (!titleMatch && !keyMatch) return false;
    }
    return true;
  });
}

/** Generate a cite-key from CSL-JSON: firstauthor + year, with disambiguation */
export function generateCiteKey(
  csl: CslJson,
  existingKeys: string[],
): string {
  let authorPart = "unknown";
  if (csl.author && csl.author.length > 0) {
    const first = csl.author[0];
    authorPart = (first.family || first.literal || "unknown")
      .toLowerCase()
      .replace(/[^a-z]/g, "");
  }

  const yearStr = getYear(csl);
  const yearPart = yearStr === "n.d." ? "" : yearStr;

  const baseKey = `${authorPart}${yearPart}`;

  if (!existingKeys.includes(baseKey)) {
    return baseKey;
  }

  // Disambiguate with suffix: a, b, c, ...
  for (let i = 0; i < 26; i++) {
    const suffix = String.fromCharCode(97 + i); // a-z
    const candidate = `${baseKey}${suffix}`;
    if (!existingKeys.includes(candidate)) {
      return candidate;
    }
  }
  return `${baseKey}_${Date.now()}`;
}
