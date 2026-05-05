// ABOUTME: DocumentSource implementation backed by a local markdown file.
// ABOUTME: Reads the file once per command run; writes apply edits via descending splice.

import { readFile, writeFile, stat } from "node:fs/promises";
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

/** Cursor identifying a markdown link span `[text](url)` in the file. */
interface MarkdownCursor {
  /** Byte offset where the link starts (the `[`). */
  start: number;
  /** Byte offset just past the link's `)`. */
  end: number;
}

/** Pandoc-style citation regex: `[@key]`, `[@key1; @key2]`, etc. */
const PANDOC_CITE_RE = /\[@([A-Za-z][A-Za-z0-9_:.-]*)(?:[;\s]+@[A-Za-z][A-Za-z0-9_:.-]*)*\]/g;
/** Standalone single-key extractor used inside a matched group. */
const PANDOC_KEY_RE = /@([A-Za-z][A-Za-z0-9_:.-]*)/g;
/** Markdown link regex `[text](url)` — non-greedy text, URL stops at first `)` or whitespace. */
const MD_LINK_RE = /\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g;

export class MarkdownDocumentSource implements DocumentSource {
  readonly kind = "markdown" as const;

  /** Absolute path used for both reading and writing. */
  readonly filePath: string;

  private cachedContent: string | null = null;

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
    const hash = createHash("sha1").update(content).digest("hex").slice(0, 12);
    return `${stats.mtimeMs}-${hash}`;
  }

  async loadAcademicReferences(): Promise<LoadRefsOutcome> {
    const text = await this.readContent();
    const refs: PendingReference[] = [];
    for (const m of text.matchAll(MD_LINK_RE)) {
      const url = m[2];
      if (!isAcademicUrl(url)) continue;
      const start = m.index ?? -1;
      if (start < 0) continue;
      refs.push({
        url,
        text: m[1],
        cursor: { start, end: start + m[0].length } satisfies MarkdownCursor,
      });
    }
    return { refs, revisionToken: await this.revisionToken() };
  }

  async writeScanResults(
    items: ScanWriteItem[],
    style: CitationStyle,
    library: LibraryEntry[],
  ): Promise<ScanWriteOutcome> {
    let text = this.cachedContent ?? (await this.readContent());

    // Apply edits highest-offset first so earlier splices don't shift later ones.
    const sorted = [...items].sort((a, b) => {
      const ac = a.ref.cursor as MarkdownCursor;
      const bc = b.ref.cursor as MarkdownCursor;
      return bc.start - ac.start;
    });

    // Markdown uses a pandoc-style key marker `[@key]` rather than a numeric
    // [N] — the key is durable across renumbering, and `cite bib` can render
    // numeric labels when generating the bibliography. The style/library args
    // are accepted for parity with the Google Docs path but unused here.
    void style;
    void library;

    const occurrenceHandles: Record<string, string[]> = {};
    for (const item of sorted) {
      const cur = item.ref.cursor as MarkdownCursor;
      const marker = `[@${item.key}]`;

      text = text.slice(0, cur.start) + marker + text.slice(cur.end);
      const handle = `${cur.start}+${marker.length}`;
      if (!occurrenceHandles[item.key]) occurrenceHandles[item.key] = [];
      occurrenceHandles[item.key].push(handle);
    }

    await writeFile(this.filePath, text, "utf-8");
    this.cachedContent = text;
    const newRevisionToken = await this.revisionToken();
    return { occurrenceHandles, newRevisionToken };
  }

  async findPresentCitationKeys(): Promise<PresentCitationsOutcome> {
    const text = await this.readContent();
    const keys = new Set<string>();
    for (const m of text.matchAll(PANDOC_CITE_RE)) {
      for (const km of m[0].matchAll(PANDOC_KEY_RE)) {
        keys.add(km[1]);
      }
    }
    return { keys, revisionToken: await this.revisionToken() };
  }

  async writeBibliography(
    bibText: string,
    options: BibWriteOptions,
  ): Promise<BibWriteOutcome> {
    let text = this.cachedContent ?? (await this.readContent());
    const heading = options.bibRangeName?.trim() || "References";

    // Render bibliography as a `## References` section. The bib content the
    // caller passes already starts with two newlines; trim whitespace so we can
    // re-anchor it underneath the heading consistently.
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

    await writeFile(this.filePath, text, "utf-8");
    this.cachedContent = text;
    return {
      bibRangeName: heading,
      newRevisionToken: await this.revisionToken(),
    };
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
