// ABOUTME: Convert a Google Doc tab into a markdown string with extracted images.
// ABOUTME: Read-only against the Google Docs API; never mutates the source doc.

import { google, type docs_v1 } from "googleapis";
import { createHash } from "node:crypto";
import { getGoogleAuth } from "./google-auth.js";

/** A single image extracted from the doc, ready to be written to disk. */
export interface ExtractedImage {
  filename: string;
  bytes: Buffer;
  contentType: string;
  altText: string;
}

export interface MarkdownExportResult {
  title: string;
  tabTitle: string;
  markdown: string;
  images: ExtractedImage[];
  warnings: string[];
}

export interface ExportOptions {
  /** Tab index to export (0 = first tab). */
  tabIndex?: number;
  /** Filename prefix for extracted images (default: docId). */
  imagePrefix?: string;
  /** Relative path written into the markdown image links (default: "./figures"). */
  imageDirRelPath?: string;
  /**
   * Optional override for fetching image bytes — useful for tests.
   * Default downloads via authed HTTPS GET against `contentUri`.
   */
  fetchImage?: (contentUri: string) => Promise<{ bytes: Buffer; contentType: string }>;
}

/**
 * Fetch a Google Doc with tab content and convert one tab to markdown.
 * Inline images are pulled out of `inlineObjects` and returned for the caller
 * to write to disk; the markdown body references them via the configured
 * relative path.
 */
export async function exportTabAsMarkdown(
  docId: string,
  options: ExportOptions = {},
): Promise<MarkdownExportResult> {
  const tabIndex = options.tabIndex ?? 0;

  const auth = await getGoogleAuth();
  if (!auth) {
    throw new Error("Google auth not configured. Run 'cite auth google' first.");
  }

  const docs = google.docs({ version: "v1", auth });
  const res = await docs.documents.get({
    documentId: docId,
    includeTabsContent: true,
  });
  const doc = res.data;

  const tabs = doc.tabs ?? [];
  if (tabs.length === 0) {
    throw new Error(
      `Document has no tabs visible to includeTabsContent. Verify the doc id and your auth scope.`,
    );
  }
  const tab = tabs[tabIndex];
  if (!tab) {
    throw new Error(
      `Tab index ${tabIndex} out of range; document has ${tabs.length} top-level tab(s).`,
    );
  }
  const documentTab = tab.documentTab;
  if (!documentTab) {
    throw new Error(`Tab at index ${tabIndex} has no documentTab content.`);
  }

  const fetchImage = options.fetchImage ?? makeAuthedImageFetcher(auth);
  const imagePrefix = options.imagePrefix ?? docId;
  const imageDirRelPath = options.imageDirRelPath ?? "./figures";

  return convertDocumentTab(documentTab, {
    title: doc.title ?? "Untitled",
    tabTitle: tab.tabProperties?.title ?? `tab-${tabIndex}`,
    fetchImage,
    imagePrefix,
    imageDirRelPath,
  });
}

interface ConvertContext {
  title: string;
  tabTitle: string;
  fetchImage: (contentUri: string) => Promise<{ bytes: Buffer; contentType: string }>;
  imagePrefix: string;
  imageDirRelPath: string;
}

/**
 * Pure conversion of a `documentTab` payload to markdown. Exported so tests
 * can feed a committed fixture JSON without hitting the Google API.
 */
export async function convertDocumentTab(
  documentTab: docs_v1.Schema$DocumentTab,
  ctx: ConvertContext,
): Promise<MarkdownExportResult> {
  const inlineObjects = documentTab.inlineObjects ?? {};
  const lists = documentTab.lists ?? {};
  const body = documentTab.body?.content ?? [];

  const images: ExtractedImage[] = [];
  const warnings: string[] = [];

  const out: string[] = [];
  for (const el of body) {
    const block = await renderStructuralElement(el, {
      lists,
      inlineObjects,
      images,
      warnings,
      ctx,
    });
    if (block) out.push(block);
  }

  // Collapse runs of blank lines and trim the head/tail.
  const markdown = out
    .join("\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim() + "\n";

  return {
    title: ctx.title,
    tabTitle: ctx.tabTitle,
    markdown,
    images,
    warnings,
  };
}

interface RenderContext {
  lists: Record<string, docs_v1.Schema$List>;
  inlineObjects: Record<string, docs_v1.Schema$InlineObject>;
  images: ExtractedImage[];
  warnings: string[];
  ctx: ConvertContext;
}

async function renderStructuralElement(
  el: docs_v1.Schema$StructuralElement,
  rc: RenderContext,
): Promise<string> {
  if (el.paragraph) {
    return renderParagraph(el.paragraph, rc);
  }
  if (el.table) {
    return renderTable(el.table, rc);
  }
  if (el.sectionBreak) {
    return "";
  }
  return "";
}

const HEADING_PREFIXES: Record<string, string> = {
  TITLE: "# ",
  SUBTITLE: "## ",
  HEADING_1: "# ",
  HEADING_2: "## ",
  HEADING_3: "### ",
  HEADING_4: "#### ",
  HEADING_5: "##### ",
  HEADING_6: "###### ",
};

async function renderParagraph(
  para: docs_v1.Schema$Paragraph,
  rc: RenderContext,
): Promise<string> {
  const elements = para.elements ?? [];

  // Detect a fenced code paragraph up front so per-run backtick wrapping
  // doesn't get nested inside the fence.
  const isCodeParagraph =
    elements.length > 0 &&
    elements.some((pe) => pe.textRun && (pe.textRun.content ?? "").trim().length > 0) &&
    elements.every(isMonospaceOrEmpty);

  if (isCodeParagraph) {
    const raw = elements.map((pe) => pe.textRun?.content ?? "").join("").replace(/\n+$/, "");
    return "```\n" + raw + "\n```";
  }

  // Render inline content (text runs + inline images) for non-code paragraphs.
  const inlineParts: string[] = [];
  for (const pe of elements) {
    if (pe.textRun) {
      inlineParts.push(renderTextRun(pe.textRun));
      continue;
    }
    if (pe.inlineObjectElement?.inlineObjectId) {
      const md = await renderInlineObject(pe.inlineObjectElement.inlineObjectId, rc);
      if (md) inlineParts.push(md);
    }
  }
  const text = inlineParts.join("").replace(/\n+$/, "");

  // Heading styles override list/bullet treatment.
  const styleType = para.paragraphStyle?.namedStyleType ?? "NORMAL_TEXT";
  if (styleType !== "NORMAL_TEXT" && HEADING_PREFIXES[styleType]) {
    return HEADING_PREFIXES[styleType] + text.trim();
  }

  // Bullet/numbered lists.
  if (para.bullet?.listId) {
    const list = rc.lists[para.bullet.listId];
    const nestingLevel = para.bullet.nestingLevel ?? 0;
    const indent = "  ".repeat(nestingLevel);
    const marker = pickListMarker(list, nestingLevel);
    return `${indent}${marker} ${text.trim()}`;
  }

  return text.trim();
}

function isMonospaceOrEmpty(pe: docs_v1.Schema$ParagraphElement): boolean {
  if (!pe.textRun) return true;
  const content = pe.textRun.content ?? "";
  if (/^\s*$/.test(content)) return true;
  return pe.textRun.textStyle?.weightedFontFamily?.fontFamily?.toLowerCase().includes("mono") ?? false;
}

function pickListMarker(
  list: docs_v1.Schema$List | undefined,
  nestingLevel: number,
): string {
  const glyphType = list?.listProperties?.nestingLevels?.[nestingLevel]?.glyphType;
  // Google Docs "DECIMAL", "UPPER_ROMAN", etc. map to ordered lists.
  if (glyphType && glyphType !== "GLYPH_TYPE_UNSPECIFIED" && glyphType !== "NONE") {
    if (/DECIMAL|ROMAN|ALPHA/.test(glyphType)) {
      return "1.";
    }
  }
  return "-";
}

function renderTextRun(run: docs_v1.Schema$TextRun): string {
  const raw = run.content ?? "";
  if (raw === "") return "";

  // Google Docs paragraph runs typically end with a trailing "\n" — preserve
  // newlines as-is for now; the paragraph renderer trims the tail.
  const style = run.textStyle ?? {};

  // Pure-whitespace runs don't get marker decoration.
  if (/^\s*$/.test(raw)) return raw;

  let text = raw;

  // Escape markdown-meaningful characters that aren't already structural.
  text = escapeMarkdownInline(text);

  if (style.link?.url) {
    return `[${text.trim()}](${style.link.url})${trailingWhitespace(raw)}`;
  }

  // Apply marks in a stable order: code → bold+italic → bold → italic.
  const isCode = style.weightedFontFamily?.fontFamily?.toLowerCase().includes("mono") ?? false;
  if (isCode) {
    return `\`${text.trim()}\`${trailingWhitespace(raw)}`;
  }

  const bold = !!style.bold;
  const italic = !!style.italic;
  if (bold && italic) text = `***${text.trim()}***${trailingWhitespace(raw)}`;
  else if (bold) text = `**${text.trim()}**${trailingWhitespace(raw)}`;
  else if (italic) text = `*${text.trim()}*${trailingWhitespace(raw)}`;

  return text;
}

function trailingWhitespace(s: string): string {
  const m = s.match(/\s+$/);
  return m ? m[0] : "";
}

function escapeMarkdownInline(s: string): string {
  // Escape characters that would otherwise be interpreted as markdown syntax
  // *inside* runs that aren't already wrapped by a marker. We intentionally
  // do NOT escape `_` or `*` because they appear in many DOI/journal names
  // and would create noise; the upstream styles drive emphasis.
  return s.replace(/([\\`])/g, "\\$1");
}

async function renderTable(
  table: docs_v1.Schema$Table,
  rc: RenderContext,
): Promise<string> {
  const rows = table.tableRows ?? [];
  if (rows.length === 0) return "";

  const renderedRows: string[][] = [];
  for (const row of rows) {
    const cells: string[] = [];
    for (const cell of row.tableCells ?? []) {
      const cellParts: string[] = [];
      for (const inner of cell.content ?? []) {
        const block = await renderStructuralElement(inner, rc);
        if (block) cellParts.push(block);
      }
      // Cell content collapses to a single line — replace internal newlines
      // with `<br>` so tables stay valid GitHub-flavoured markdown.
      const text = cellParts.join(" ").replace(/\n+/g, " <br> ").trim();
      cells.push(text || " ");
    }
    renderedRows.push(cells);
  }

  const colCount = Math.max(...renderedRows.map((r) => r.length));
  const padded = renderedRows.map((r) => {
    while (r.length < colCount) r.push(" ");
    return r;
  });

  const header = padded[0];
  const separator = new Array(colCount).fill("---");
  const body = padded.slice(1);

  const lines: string[] = [];
  lines.push("| " + header.join(" | ") + " |");
  lines.push("| " + separator.join(" | ") + " |");
  for (const r of body) lines.push("| " + r.join(" | ") + " |");
  return lines.join("\n");
}

async function renderInlineObject(
  inlineObjectId: string,
  rc: RenderContext,
): Promise<string> {
  const obj = rc.inlineObjects[inlineObjectId];
  const embedded = obj?.inlineObjectProperties?.embeddedObject;
  if (!embedded) {
    rc.warnings.push(`inline object ${inlineObjectId}: no embeddedObject`);
    return "";
  }

  const imageProps = embedded.imageProperties;
  const contentUri = imageProps?.contentUri;
  if (!contentUri) {
    rc.warnings.push(`inline object ${inlineObjectId}: no imageProperties.contentUri (linked drawing or unsupported embed)`);
    return "";
  }

  const altText = (embedded.title || embedded.description || "").trim();
  const slug = sanitizeForFilename(altText) || shortHash(inlineObjectId);

  let bytes: Buffer;
  let contentType = "image/png";
  try {
    const fetched = await rc.ctx.fetchImage(contentUri);
    bytes = fetched.bytes;
    contentType = fetched.contentType || contentType;
  } catch (err: any) {
    rc.warnings.push(`inline object ${inlineObjectId}: image fetch failed (${err.message})`);
    return "";
  }

  const ext = extensionFromContentType(contentType);
  const filename = `${rc.ctx.imagePrefix}_${slug}.${ext}`;
  rc.images.push({ filename, bytes, contentType, altText });

  const relPath = `${rc.ctx.imageDirRelPath.replace(/\/+$/, "")}/${filename}`;
  const alt = altText || filename.replace(/\.[a-z]+$/i, "");
  return `![${alt}](${relPath})`;
}

function sanitizeForFilename(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
}

function shortHash(s: string): string {
  return createHash("sha1").update(s).digest("hex").slice(0, 8);
}

function extensionFromContentType(ct: string): string {
  const mt = ct.toLowerCase();
  if (mt.includes("png")) return "png";
  if (mt.includes("jpeg") || mt.includes("jpg")) return "jpg";
  if (mt.includes("gif")) return "gif";
  if (mt.includes("svg")) return "svg";
  if (mt.includes("webp")) return "webp";
  return "png";
}

function makeAuthedImageFetcher(auth: any) {
  return async (contentUri: string): Promise<{ bytes: Buffer; contentType: string }> => {
    // googleapis OAuth2Client.request handles token refresh + headers for us.
    const res = await auth.request({ url: contentUri, responseType: "arraybuffer" });
    const data = res.data as ArrayBuffer | Buffer;
    const bytes = Buffer.isBuffer(data) ? data : Buffer.from(new Uint8Array(data as ArrayBuffer));
    const contentType = (res.headers?.["content-type"] as string | undefined) ?? "image/png";
    return { bytes, contentType };
  };
}
