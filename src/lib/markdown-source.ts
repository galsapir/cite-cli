// ABOUTME: DocumentSource implementation backed by a local markdown file.
// ABOUTME: Reads markdown once per command run and writes citation edits atomically.

import { readFile, writeFile, rename, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve as resolvePath } from "node:path";
import lockfile from "proper-lockfile";
import { isAcademicUrl } from "./google-docs.js";
import type {
  BibWriteOptions,
  BibWriteOutcome,
  DocumentSource,
  LoadRefsOutcome,
  PendingReference,
  PresentCitationsOutcome,
  ScanWriteItem,
  ScanWriteOutcome,
} from "./document-source.js";
import type { CitationStyle, LibraryEntry } from "../types/index.js";

export interface MarkdownCursor {
  start: number;
  end: number;
}

/** A single `@key` occurrence in document order with its character span. */
export interface MarkdownCitationOccurrence {
  key: string;
  start: number;
  end: number;
}

export interface MarkdownCitationBracket {
  start: number;
  end: number;
  content: string;
  keys: string[];
}

export interface MarkdownInsertAnchor {
  type: "after" | "paragraph";
  /** For "after": literal case-sensitive text; for "paragraph": 1-indexed paragraph number. */
  value: string | number;
  /** For "after": target occurrence, 1-indexed. Ignored for paragraph anchors. */
  occurrence?: number;
  /** For "paragraph": insertion at paragraph start or text end. Ignored for after anchors. */
  position?: "start" | "end";
}

const PANDOC_CITE_RE = /\[[^\]]*@[A-Za-z][A-Za-z0-9_:.-]*[^\]]*\]/g;
const PANDOC_KEY_RE = /(?:^|[^A-Za-z0-9_])-?@([A-Za-z][A-Za-z0-9_:.-]*)/g;
/** Non-global variant of PANDOC_KEY_RE for finding the FIRST @-token in a segment. */
const PANDOC_KEY_FIRST_RE = /(?:^|[^A-Za-z0-9_])-?@([A-Za-z][A-Za-z0-9_:.-]*)/;

/** Thrown when the file changed on disk between load and write. */
export class MarkdownChangedDuringRunError extends Error {
  constructor(filePath: string) {
    super(
      `Markdown file changed on disk since cite started reading it (${filePath}). ` +
      `Re-run the command — your edits would otherwise be overwritten.`,
    );
    this.name = "MarkdownChangedDuringRunError";
  }
}

export class MarkdownAnchorNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MarkdownAnchorNotFoundError";
  }
}

export class MarkdownLockTimeoutError extends Error {
  constructor(filePath: string) {
    super(
      `Could not acquire lock on ${filePath} within timeout. Another 'cite' process may be running. ` +
      `If you're sure no other process holds it, remove ${filePath}.cite.lock and re-run.`,
    );
    this.name = "MarkdownLockTimeoutError";
  }
}

type LockRelease = () => Promise<void>;

export async function acquireMarkdownLock(filePath: string): Promise<LockRelease> {
  try {
    return await lockfile.lock(filePath, {
      stale: 30_000,
      retries: { retries: 5, factor: 1.5, minTimeout: 100, maxTimeout: 1000 },
      lockfilePath: `${filePath}.cite.lock`,
      // Paths reaching here are already absolute (resolvePath in the source
      // class). realpath: false skips symlink resolution AND lstat on the
      // target — required because a manifest's bibliography file may not
      // yet exist on disk when we lock (auto-created later by the bib write).
      realpath: false,
    });
  } catch (err: any) {
    if (/locked|ELOCKED/i.test(String(err?.code) + String(err?.message))) {
      throw new MarkdownLockTimeoutError(filePath);
    }
    throw err;
  }
}

export class MarkdownDocumentSource implements DocumentSource {
  readonly kind = "markdown" as const;

  readonly filePath: string;

  private cachedContent: string | null = null;
  private loadedRevisionToken: string | null = null;

  constructor(filePath: string) {
    this.filePath = resolvePath(filePath);
  }

  describe(): string {
    return `markdown:${this.filePath}`;
  }

  async runWithLock<T>(operation: () => Promise<T>): Promise<T> {
    const release = await acquireMarkdownLock(this.filePath);
    try {
      return await operation();
    } finally {
      await release();
    }
  }

  private async readContent(): Promise<string> {
    const text = await readFile(this.filePath, "utf-8");
    this.cachedContent = text;
    return text;
  }

  /** mtime-and-content hash; cheap to compute, sensitive to edits. */
  async revisionToken(): Promise<string> {
    const [stats, content] = await Promise.all([
      stat(this.filePath),
      this.cachedContent ? Promise.resolve(this.cachedContent) : this.readContent(),
    ]);
    return computeToken(stats.mtimeMs, content);
  }

  private async freshRevisionToken(): Promise<string> {
    const text = await readFile(this.filePath, "utf-8");
    const stats = await stat(this.filePath);
    return computeToken(stats.mtimeMs, text);
  }

  /** File content as last seen by this source — cached if a prior method has read it. */
  async getContent(): Promise<string> {
    return this.cachedContent ?? (await this.readContent());
  }

  private async assertUnchangedSinceLoad(): Promise<void> {
    if (this.loadedRevisionToken === null) return;
    const fresh = await this.freshRevisionToken();
    if (fresh !== this.loadedRevisionToken) {
      throw new MarkdownChangedDuringRunError(this.filePath);
    }
  }

  /**
   * Force-refresh the cached content + revision baseline so the next
   * mutating call asserts against current on-disk state. Required for
   * write paths whose caller hasn't already invoked a "load" method
   * (e.g. composing sources reading bib via revisionToken() but never
   * scanning it).
   */
  async establishWritePrecondition(): Promise<void> {
    this.cachedContent = null;
    this.loadedRevisionToken = null;
    await this.readContent();
    this.loadedRevisionToken = await this.revisionToken();
  }

  async loadAcademicReferences(): Promise<LoadRefsOutcome> {
    const text = await this.readContent();
    const refs: PendingReference[] = [];
    for (const link of findMarkdownLinks(text)) {
      if (!isAcademicUrl(link.url)) continue;
      refs.push({
        url: link.url,
        text: link.text,
        cursor: { start: link.start, end: link.end } satisfies MarkdownCursor,
      });
    }
    const token = await this.revisionToken();
    this.loadedRevisionToken = token;
    return { refs, revisionToken: token };
  }

  async writeScanResults(
    items: ScanWriteItem[],
    _style: CitationStyle,
    _library: LibraryEntry[],
  ): Promise<ScanWriteOutcome> {
    await this.assertUnchangedSinceLoad();
    let text = this.cachedContent ?? (await this.readContent());

    const sorted = [...items].sort((a, b) => {
      const ac = a.ref.cursor as MarkdownCursor;
      const bc = b.ref.cursor as MarkdownCursor;
      return bc.start - ac.start;
    });

    const occurrenceHandles: Record<string, string[]> = {};
    for (const item of sorted) {
      const cur = item.ref.cursor as MarkdownCursor;
      const marker = `[@${item.key}]`;

      text = text.slice(0, cur.start) + marker + text.slice(cur.end);
      const handle = `${cur.start}+${marker.length}`;
      if (!occurrenceHandles[item.key]) occurrenceHandles[item.key] = [];
      occurrenceHandles[item.key].push(handle);
    }

    await atomicWriteFile(this.filePath, text);
    this.cachedContent = text;
    const newRevisionToken = await this.revisionToken();
    this.loadedRevisionToken = newRevisionToken;
    return { occurrenceHandles, newRevisionToken };
  }

  async findPresentCitationKeys(): Promise<PresentCitationsOutcome> {
    const occurrences = await this.scanCitationOccurrences();
    const keys = new Set<string>();
    for (const occurrence of occurrences) keys.add(occurrence.key);
    const token = await this.revisionToken();
    this.loadedRevisionToken = token;
    return { keys, revisionToken: token };
  }

  async locateInsertionPoint(anchor: MarkdownInsertAnchor): Promise<number> {
    const text = this.cachedContent ?? (await this.readContent());
    const token = await this.revisionToken();
    this.loadedRevisionToken = token;

    if (anchor.type === "after") {
      const searchText = String(anchor.value);
      const occurrence = anchor.occurrence ?? 1;
      if (!Number.isInteger(occurrence) || occurrence < 1) {
        throw new MarkdownAnchorNotFoundError(`Occurrence must be a positive integer; got ${occurrence}.`);
      }

      let from = 0;
      for (let seen = 1; ; seen++) {
        const index = text.indexOf(searchText, from);
        if (index === -1) {
          throw new MarkdownAnchorNotFoundError(
            `Text "${searchText}" not found in markdown file at occurrence ${occurrence}.`,
          );
        }
        if (seen === occurrence) return index + searchText.length;
        from = index + searchText.length;
      }
    }

    const paragraphNumber = Number(anchor.value);
    if (!Number.isInteger(paragraphNumber) || paragraphNumber < 1) {
      throw new MarkdownAnchorNotFoundError(`Paragraph must be a positive integer; got ${anchor.value}.`);
    }
    const paragraphs = markdownParagraphSpans(text);
    const paragraph = paragraphs[paragraphNumber - 1];
    if (!paragraph) {
      throw new MarkdownAnchorNotFoundError(
        `Paragraph ${paragraphNumber} not found in markdown file (${paragraphs.length} paragraph(s)).`,
      );
    }
    return anchor.position === "start" ? paragraph.start : paragraph.end;
  }

  async writeInsertion(offset: number, marker: string): Promise<{ newRevisionToken: string }> {
    await this.assertUnchangedSinceLoad();
    const text = this.cachedContent ?? (await this.readContent());
    const nextText = text.slice(0, offset) + marker + text.slice(offset);

    await atomicWriteFile(this.filePath, nextText);
    this.cachedContent = nextText;
    const newRevisionToken = await this.revisionToken();
    this.loadedRevisionToken = newRevisionToken;
    return { newRevisionToken };
  }

  /**
   * Walk the file and return every cite-key occurrence in document order.
   *
   * Per pandoc grammar, only the FIRST `@key` (or `-@key`) of a `;`-separated
   * segment is the cite-key; subsequent `@…` tokens in the segment are
   * literal suffix text, not citations. We emit one occurrence per segment.
   *
   * The `start`/`end` span covers `@key` only — it deliberately excludes a
   * leading `-` (author-suppressed pandoc form) and the surrounding `[…]`.
   * Callers that delete by this span need to consider the surrounding
   * separators and bracket structure themselves.
   */
  async scanCitationOccurrences(): Promise<MarkdownCitationOccurrence[]> {
    const text = this.cachedContent ?? (await this.readContent());
    const occurrences: MarkdownCitationOccurrence[] = [];
    for (const m of text.matchAll(PANDOC_CITE_RE)) {
      const citationStart = m.index ?? 0;
      const after = text[citationStart + m[0].length];
      if (after === "(") continue;
      const content = m[0].slice(1, -1);
      const contentStart = citationStart + 1;
      let segStart = 0;
      for (let i = 0; i <= content.length; i++) {
        if (i === content.length || content[i] === ";") {
          const segText = content.slice(segStart, i);
          const km = segText.match(PANDOC_KEY_FIRST_RE);
          if (km && km.index !== undefined) {
            const atOffset = km[0].lastIndexOf("@");
            const start = contentStart + segStart + km.index + atOffset;
            occurrences.push({
              key: km[1],
              start,
              end: start + km[1].length + 1,
            });
          }
          segStart = i + 1;
        }
      }
    }
    return occurrences;
  }

  async scanCitationBrackets(): Promise<MarkdownCitationBracket[]> {
    const text = this.cachedContent ?? (await this.readContent());
    const brackets: MarkdownCitationBracket[] = [];
    for (const m of text.matchAll(PANDOC_CITE_RE)) {
      const start = m.index ?? 0;
      const end = start + m[0].length;
      if (text[end] === "(") continue;
      const content = m[0].slice(1, -1);
      const keys = citationKeysInText(content);
      brackets.push({ start, end, content, keys });
    }
    const token = await this.revisionToken();
    this.loadedRevisionToken = token;
    return brackets;
  }

  async removeCiteKey(key: string): Promise<{
    bodyOccurrencesRemoved: number;
    bracketsRewritten: number;
    bracketsDeleted: number;
    newRevisionToken: string;
  }> {
    await this.assertUnchangedSinceLoad();
    const brackets = await this.scanCitationBrackets();
    let text = this.cachedContent ?? (await this.readContent());
    let bodyOccurrencesRemoved = 0;
    let bracketsRewritten = 0;
    let bracketsDeleted = 0;

    for (const bracket of [...brackets].reverse()) {
      if (!bracket.keys.includes(key)) continue;

      // Pandoc grammar: each `;`-separated segment is one citation. The first
      // `@key` (or `-@key`) of the segment is THE cite-key; any further
      // `@…` tokens are literal suffix text. So a segment matches iff its
      // primary key is the target.
      const segments = bracket.content.split(";");
      const remainingSegments: string[] = [];
      let removedFromBracket = 0;

      for (const segment of segments) {
        if (primaryCiteKey(segment) === key) {
          removedFromBracket += 1;
        } else {
          remainingSegments.push(segment.trim());
        }
      }

      if (removedFromBracket === 0) continue;
      bodyOccurrencesRemoved += removedFromBracket;

      if (remainingSegments.length === 0) {
        const deleteRange = citationBracketDeletionRange(text, bracket.start, bracket.end);
        text = text.slice(0, deleteRange.start) + text.slice(deleteRange.end);
        bracketsDeleted++;
      } else {
        text = text.slice(0, bracket.start + 1) + remainingSegments.join("; ") + text.slice(bracket.end - 1);
        bracketsRewritten++;
      }
    }

    await atomicWriteFile(this.filePath, text);
    this.cachedContent = text;
    const newRevisionToken = await this.revisionToken();
    this.loadedRevisionToken = newRevisionToken;
    return { bodyOccurrencesRemoved, bracketsRewritten, bracketsDeleted, newRevisionToken };
  }

  async writeBibliography(
    bibText: string,
    options: BibWriteOptions,
  ): Promise<BibWriteOutcome> {
    await this.assertUnchangedSinceLoad();
    let text = this.cachedContent ?? (await this.readContent());
    const heading = options.bibRangeName?.trim() || "References";

    const bibBody = bibText.replace(/^\s+|\s+$/g, "");
    const replacement = `## ${heading}\n\n${bibBody}\n`;

    const sectionRe = new RegExp(
      `(^|\\n)## +${escapeRegex(heading)}[ \\t]*\\n[\\s\\S]*?(?=\\n## |\\n# |$)`,
      "i",
    );
    const m = text.match(sectionRe);
    if (m) {
      const matchStart = (m.index ?? 0) + (m[1] ? m[1].length : 0);
      const matchEnd = matchStart + m[0].length - (m[1]?.length ?? 0);
      text = text.slice(0, matchStart) + replacement + text.slice(matchEnd).replace(/^\n+/, "");
    } else {
      const sep = text.endsWith("\n") ? "\n" : "\n\n";
      text = text + sep + replacement;
    }
    if (!text.endsWith("\n")) text += "\n";

    await atomicWriteFile(this.filePath, text);
    this.cachedContent = text;
    const newRevisionToken = await this.revisionToken();
    this.loadedRevisionToken = newRevisionToken;
    return {
      bibRangeName: heading,
      newRevisionToken,
    };
  }
}

function computeToken(mtimeMs: number, content: string): string {
  const hash = createHash("sha1").update(content).digest("hex").slice(0, 12);
  return `${mtimeMs}-${hash}`;
}

/**
 * Paragraph anchors are blocks separated by one or more blank lines.
 * Handles both LF and CRLF line endings. Trailing newlines are excluded
 * from each paragraph's `end`.
 */
function markdownParagraphSpans(text: string): Array<{ start: number; end: number }> {
  const spans: Array<{ start: number; end: number }> = [];
  const delimiterRe = /(?:\r?\n[ \t]*){2,}/g;
  let start = 0;
  for (const match of text.matchAll(delimiterRe)) {
    const delimiterStart = match.index ?? 0;
    if (delimiterStart > start) {
      spans.push({ start, end: trimTrailingParagraphNewlines(text, delimiterStart) });
    }
    start = delimiterStart + match[0].length;
  }
  if (start < text.length) {
    spans.push({ start, end: trimTrailingParagraphNewlines(text, text.length) });
  }
  return spans;
}

function trimTrailingParagraphNewlines(text: string, end: number): number {
  let trimmed = end;
  while (trimmed > 0) {
    const ch = text[trimmed - 1];
    if (ch !== "\n" && ch !== "\r") break;
    trimmed--;
  }
  return trimmed;
}

/**
 * Write atomically: write to a sibling temp file, then rename. Crash mid-write
 * leaves either the old file intact or the temp file orphaned, never a
 * truncated target.
 */
async function atomicWriteFile(path: string, content: string): Promise<void> {
  const tmp = `${path}.cite.tmp.${process.pid}.${Date.now()}`;
  await writeFile(tmp, content, "utf-8");
  await rename(tmp, path);
}

function citationKeysInText(text: string): string[] {
  const keys: string[] = [];
  for (const km of text.matchAll(PANDOC_KEY_RE)) keys.push(km[1]);
  return keys;
}

/**
 * Per pandoc grammar, the FIRST `@key` (or `-@key`) of a `;`-separated
 * segment is the cite-key; subsequent `@…` tokens are literal suffix text.
 * Returns null if the segment has no `@key` at all.
 */
function primaryCiteKey(segment: string): string | null {
  const m = segment.match(PANDOC_KEY_FIRST_RE);
  return m ? m[1] : null;
}

function citationBracketDeletionRange(
  text: string,
  start: number,
  end: number,
): { start: number; end: number } {
  if (start > 0 && text[start - 1] === " ") return { start: start - 1, end };
  if (end < text.length && text[end] === " ") return { start, end: end + 1 };
  return { start, end };
}

interface MarkdownLink {
  start: number;
  end: number;
  text: string;
  url: string;
}

/**
 * Yield markdown link spans `[text](url)`. Allows balanced parens and escapes
 * inside the URL — the regex form `[^)\s]+` truncates on the first `)`, which
 * mangles real DOI URLs like `https://doi.org/10.1000/(abc)def`.
 */
function* findMarkdownLinks(text: string): Generator<MarkdownLink> {
  let i = 0;
  while (i < text.length) {
    const lb = text.indexOf("[", i);
    if (lb < 0) return;

    let rb = -1;
    for (let j = lb + 1; j < text.length; j++) {
      const c = text[j];
      if (c === "\n" || c === "[") break;
      if (c === "\\") { j++; continue; }
      if (c === "]") { rb = j; break; }
    }
    if (rb < 0 || text[rb + 1] !== "(") { i = lb + 1; continue; }

    let depth = 1;
    const urlStart = rb + 2;
    let k = urlStart;
    let closeParen = -1;
    while (k < text.length) {
      const c = text[k];
      if (c === "\\") { k += 2; continue; }
      if (c === " " || c === "\t" || c === "\n") break;
      if (c === "(") { depth++; k++; continue; }
      if (c === ")") {
        depth--;
        if (depth === 0) { closeParen = k; break; }
        k++; continue;
      }
      k++;
    }
    if (closeParen < 0) { i = lb + 1; continue; }

    const url = text.slice(urlStart, closeParen);
    if (!/^https?:\/\//.test(url)) { i = lb + 1; continue; }

    yield {
      start: lb,
      end: closeParen + 1,
      text: text.slice(lb + 1, rb),
      url,
    };
    i = closeParen + 1;
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
