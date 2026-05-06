// ABOUTME: Manages per-document citation state (citations, style, sync info).
// ABOUTME: Persists state as JSON files in ~/.cite/docs/ keyed by a stable docId.

import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, resolve as resolvePath } from "node:path";
import { getCiteDir } from "./config.js";
import type { DocState, DocSource, CitationStyle } from "../types/index.js";

function docStatePath(docId: string): string {
  return join(getCiteDir(), "docs", `${docId}.json`);
}

/** Stable state-file key for a given source. */
export function stateKeyForSource(source: DocSource): string {
  if (source.type === "google-docs") return source.docId;
  if (source.type === "markdown-manifest") {
    const abs = resolvePath(source.manifestPath);
    const hash = createHash("sha1").update(abs).digest("hex").slice(0, 12);
    return `mfst_${hash}`;
  }
  const abs = resolvePath(source.filePath);
  const hash = createHash("sha1").update(abs).digest("hex").slice(0, 12);
  return `md_${hash}`;
}

export async function loadDocState(docId: string): Promise<DocState | null> {
  const path = docStatePath(docId);
  try {
    const raw = await readFile(path, "utf-8");
    const parsed = JSON.parse(raw) as Partial<DocState> & { docId: string };

    // Transparent migration: legacy state files predate the `source` field;
    // they always referred to a Google Doc whose ID equals docId.
    if (!parsed.source) {
      parsed.source = { type: "google-docs", docId: parsed.docId };
    }

    return parsed as DocState;
  } catch (err: any) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
}

export async function saveDocState(state: DocState): Promise<void> {
  const path = docStatePath(state.docId);
  await writeFile(path, JSON.stringify(state, null, 2), "utf-8");
}

export async function initDocStateForGoogleDoc(
  docId: string,
  libraryId: string,
  style: CitationStyle,
): Promise<DocState> {
  const existing = await loadDocState(docId);
  if (existing) {
    throw new Error(
      `Doc ${docId} is already initialized. Use 'cite audit' to check its state.`,
    );
  }
  const state: DocState = {
    docId,
    source: { type: "google-docs", docId },
    libraryId,
    style,
    citations: [],
    lastSync: new Date().toISOString(),
  };
  await saveDocState(state);
  return state;
}

export async function initDocStateForMarkdown(
  filePath: string,
  libraryId: string,
  style: CitationStyle,
): Promise<DocState> {
  const abs = resolvePath(filePath);
  const source: DocSource = { type: "markdown", filePath: abs };
  const stateKey = stateKeyForSource(source);
  const existing = await loadDocState(stateKey);
  if (existing) {
    throw new Error(
      `Markdown file ${filePath} is already initialized. Use 'cite audit' to check its state.`,
    );
  }
  const state: DocState = {
    docId: stateKey,
    source,
    libraryId,
    style,
    citations: [],
    lastSync: new Date().toISOString(),
  };
  await saveDocState(state);
  return state;
}

export async function initDocStateForManifest(
  manifestPath: string,
  libraryId: string,
  style: CitationStyle,
): Promise<DocState> {
  const abs = resolvePath(manifestPath);
  const source: DocSource = { type: "markdown-manifest", manifestPath: abs };
  const stateKey = stateKeyForSource(source);
  const existing = await loadDocState(stateKey);
  if (existing) {
    throw new Error(
      `Manifest ${abs} is already initialized. Use 'cite audit' to check its state.`,
    );
  }
  const state: DocState = {
    docId: stateKey,
    source,
    libraryId,
    style,
    citations: [],
    lastSync: new Date().toISOString(),
  };
  await saveDocState(state);
  return state;
}

/**
 * Backwards-compatible constructor used by existing tests that init by docId only.
 * New code should call initDocStateForGoogleDoc / initDocStateForMarkdown directly.
 */
export async function initDocState(
  docId: string,
  libraryId: string,
  style: CitationStyle,
): Promise<DocState> {
  return initDocStateForGoogleDoc(docId, libraryId, style);
}
