import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { getCiteDir } from "./config.js";
import type { DocState } from "../types/index.js";

function docStatePath(docId: string): string {
  return join(getCiteDir(), "docs", `${docId}.json`);
}

export async function loadDocState(docId: string): Promise<DocState | null> {
  const path = docStatePath(docId);
  if (!existsSync(path)) {
    return null;
  }
  const raw = await readFile(path, "utf-8");
  return JSON.parse(raw) as DocState;
}

export async function saveDocState(state: DocState): Promise<void> {
  const path = docStatePath(state.docId);
  await writeFile(path, JSON.stringify(state, null, 2), "utf-8");
}

export async function initDocState(
  docId: string,
  libraryId: string,
  style: string,
): Promise<DocState> {
  const existing = await loadDocState(docId);
  if (existing) {
    throw new Error(
      `Doc ${docId} is already initialized. Use 'cite audit' to check its state.`,
    );
  }

  const state: DocState = {
    docId,
    libraryId,
    style,
    citations: [],
    lastSync: new Date().toISOString(),
  };

  await saveDocState(state);
  return state;
}
