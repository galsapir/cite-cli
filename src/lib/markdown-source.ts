// ABOUTME: DocumentSource implementation backed by a local markdown file.
// ABOUTME: Reads the file once per command run; writes apply edits via descending splice.

import { readFile, writeFile, rename, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve as resolvePath } from "node:path";
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

interface MarkdownCursor {
  start: number;
  end: number;
}

/** A single `@key` occurrence in document order with its character span. */
export interface MarkdownCitationOccurrence {
  key: string;
  start: number;
  end: number;
}

const PANDOC_CITE_RE = /\[[^\]]*@[A-Za-z][A-Za-z0-9_:.-]*[^\]]*\]/g;
const PANDOC_KEY_RE = /(?:^|[^A-Za-z0-9_])-?@([A-Za-z][A-Za-z0-9_:.-]*)/g;

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

  private async assertUnchangedSinceLoad(): Promise<void> {
    if (this.loadedRevisionToken === null) return;
    const fresh = await this.freshRevisionToken();
    if (fresh !== this.loadedRevisionToken) {
      throw new MarkdownChangedDuringRunError(this.filePath);
    }
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

  /**
   * Walk the file and return every cite-key occurrence in document order.
   *
   * The `start`/`end` span covers `@key` only — it deliberately excludes a
   * leading `-` (author-suppressed pandoc form) and the surrounding `[…]`.
   * Callers that delete by this span need to consider the surrounding
   * separators and bracket structure themselves.
   */
  async scanCitationOccurrences(): Promise<MarkdownCitationOccurrence[]> {
    const text = await this.readContent();
    const occurrences: MarkdownCitationOccurrence[] = [];
    for (const m of text.matchAll(PANDOC_CITE_RE)) {
      const citationStart = m.index ?? 0;
      const after = text[citationStart + m[0].length];
      if (after === "(") continue;
      for (const km of m[0].matchAll(PANDOC_KEY_RE)) {
        const matchStart = citationStart + (km.index ?? 0);
        const atOffset = km[0].lastIndexOf("@");
        const start = matchStart + atOffset;
        occurrences.push({
          key: km[1],
          start,
          end: start + km[1].length + 1,
        });
      }
    }
    return occurrences;
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
 * Write atomically: write to a sibling temp file, then rename. Crash mid-write
 * leaves either the old file intact or the temp file orphaned, never a
 * truncated target.
 */
async function atomicWriteFile(path: string, content: string): Promise<void> {
  const tmp = `${path}.cite.tmp.${process.pid}.${Date.now()}`;
  await writeFile(tmp, content, "utf-8");
  await rename(tmp, path);
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
