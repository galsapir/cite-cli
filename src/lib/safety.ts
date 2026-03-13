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

/** Result of validating batch update requests */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validate that all batch update requests target indices within the
 * document body bounds.  Google Docs body indices start at 1 and the
 * last valid index is `bodyEndIndex - 1` (the final newline).
 */
export function validateRequestBounds(
  requests: docs_v1.Schema$Request[],
  bodyEndIndex: number,
): ValidationResult {
  const errors: string[] = [];

  for (const req of requests) {
    // Skip structural requests that don't reference a position
    if (req.deleteNamedRange || req.createNamedRange || req.replaceAllText) {
      continue;
    }

    if (req.insertText) {
      const idx = req.insertText.location?.index;
      if (idx == null) {
        errors.push("insertText request missing location.index");
        continue;
      }
      if (idx < 1) {
        errors.push(`insertText index ${idx} is below minimum (1)`);
      }
      if (idx > bodyEndIndex - 1) {
        errors.push(
          `insertText index ${idx} exceeds document end (${bodyEndIndex - 1})`,
        );
      }
    }

    if (req.deleteContentRange) {
      const range = req.deleteContentRange.range;
      if (!range || range.startIndex == null || range.endIndex == null) {
        errors.push("deleteContentRange request missing range indices");
        continue;
      }
      if (range.startIndex < 1) {
        errors.push(
          `deleteContentRange startIndex ${range.startIndex} is below minimum (1)`,
        );
      }
      if (range.endIndex > bodyEndIndex) {
        errors.push(
          `deleteContentRange endIndex ${range.endIndex} exceeds document end (${bodyEndIndex})`,
        );
      }
      if (range.startIndex >= range.endIndex) {
        errors.push(
          `deleteContentRange has invalid range: startIndex (${range.startIndex}) >= endIndex (${range.endIndex})`,
        );
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate that no two delete ranges overlap.  Overlapping deletes in a
 * single batchUpdate cause unpredictable behavior because one deletion
 * shifts indices that the other depends on.
 */
export function validateNoOverlappingDeletes(
  requests: docs_v1.Schema$Request[],
): ValidationResult {
  const errors: string[] = [];

  const deleteRanges: Array<{ start: number; end: number }> = [];
  for (const req of requests) {
    const range = req.deleteContentRange?.range;
    if (range?.startIndex != null && range?.endIndex != null) {
      deleteRanges.push({ start: range.startIndex, end: range.endIndex });
    }
  }

  // Sort by start index so we only need to check adjacent pairs
  deleteRanges.sort((a, b) => a.start - b.start);

  for (let i = 0; i < deleteRanges.length - 1; i++) {
    const current = deleteRanges[i];
    const next = deleteRanges[i + 1];
    if (current.end > next.start) {
      errors.push(
        `Overlapping delete ranges: [${current.start}..${current.end}) and [${next.start}..${next.end})`,
      );
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Compute the document body end index from structural elements.
 * Returns the endIndex of the last element, or 1 if the body is empty.
 */
export function getBodyEndIndex(
  body: docs_v1.Schema$StructuralElement[],
): number {
  if (body.length === 0) return 1;
  const last = body[body.length - 1];
  return last.endIndex ?? 1;
}

/**
 * Run all pre-write validations on a set of batch update requests.
 * Throws an error with a descriptive message if any check fails.
 */
export function validateBatchRequests(
  requests: docs_v1.Schema$Request[],
  body: docs_v1.Schema$StructuralElement[],
): void {
  const endIndex = getBodyEndIndex(body);

  const boundsResult = validateRequestBounds(requests, endIndex);
  const overlapResult = validateNoOverlappingDeletes(requests);

  const allErrors = [...boundsResult.errors, ...overlapResult.errors];
  if (allErrors.length > 0) {
    throw new Error(
      `Safety check failed — refusing to write:\n  • ${allErrors.join("\n  • ")}`,
    );
  }
}
