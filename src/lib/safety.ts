// ABOUTME: Safety utilities for Google Docs batch updates.
// ABOUTME: Reverse-index sorting, revision checks, operation logging, and previews.

import { appendFile } from "node:fs/promises";
import { join } from "node:path";
import { getCiteDir, ensureCiteDir } from "./config.js";
import chalk from "chalk";
import type { docs_v1 } from "googleapis";

/** Log an operation to the doc's operation log */
export async function logOperation(
  docId: string,
  operation: string,
): Promise<void> {
  await ensureCiteDir();
  const logPath = join(getCiteDir(), "docs", `${docId}.log`);
  const timestamp = new Date().toISOString();
  await appendFile(logPath, `${timestamp} ${operation}\n`, "utf-8");
}

/** Sort batch update requests in reverse index order for safe insertion */
export function sortRequestsReverseIndex(
  requests: docs_v1.Schema$Request[],
): docs_v1.Schema$Request[] {
  return [...requests].sort((a, b) => {
    const idxA = getRequestIndex(a);
    const idxB = getRequestIndex(b);
    return idxB - idxA; // Highest index first
  });
}

function getRequestIndex(req: docs_v1.Schema$Request): number {
  if (req.insertText?.location?.index != null) {
    return req.insertText.location.index;
  }
  if (req.deleteContentRange?.range?.startIndex != null) {
    return req.deleteContentRange.range.startIndex;
  }
  if (req.replaceAllText) {
    return 0; // Replace-all doesn't have a specific index
  }
  return 0;
}

/** Format a preview of what will be inserted */
export function formatInsertPreview(
  text: string,
  context: string,
  paragraphIndex: number,
  charIndex: number,
): string {
  const lines: string[] = [];
  lines.push(chalk.bold("Preview:"));
  lines.push(
    `  Will insert ${chalk.cyan(text)} at paragraph ${paragraphIndex + 1}, index ${charIndex}`,
  );
  lines.push("");
  lines.push(`  Context: ...${context.slice(0, 50)}${chalk.green(text)}${context.slice(50)}...`);
  return lines.join("\n");
}

/** Format a preview of bibliography content */
export function formatBibPreview(entries: string[]): string {
  const lines: string[] = [];
  lines.push(chalk.bold("Bibliography preview:"));
  lines.push("");
  for (const entry of entries) {
    lines.push(`  ${entry}`);
  }
  return lines.join("\n");
}

/** Check if a revision ID matches (detect concurrent edits) */
export function checkRevisionId(
  expected: string,
  actual: string,
): boolean {
  if (!expected || !actual) return true; // Can't check if missing
  return expected === actual;
}
