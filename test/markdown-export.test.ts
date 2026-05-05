import { describe, it, expect } from "vitest";
import { convertDocumentTab } from "../src/lib/markdown-export.js";
import type { docs_v1 } from "googleapis";

function para(
  text: string,
  opts: {
    style?: string;
    bold?: boolean;
    italic?: boolean;
    link?: string;
    monospace?: boolean;
    bulletListId?: string;
    nestingLevel?: number;
    inlineObjectId?: string;
  } = {},
): docs_v1.Schema$StructuralElement {
  const elements: docs_v1.Schema$ParagraphElement[] = [];
  if (opts.inlineObjectId) {
    elements.push({ inlineObjectElement: { inlineObjectId: opts.inlineObjectId } });
  }
  if (text) {
    elements.push({
      textRun: {
        content: text + "\n",
        textStyle: {
          bold: opts.bold,
          italic: opts.italic,
          link: opts.link ? { url: opts.link } : undefined,
          weightedFontFamily: opts.monospace
            ? { fontFamily: "Roboto Mono", weight: 400 }
            : undefined,
        },
      },
    });
  }
  return {
    paragraph: {
      paragraphStyle: { namedStyleType: opts.style ?? "NORMAL_TEXT" },
      bullet: opts.bulletListId
        ? { listId: opts.bulletListId, nestingLevel: opts.nestingLevel ?? 0 }
        : undefined,
      elements,
    },
  };
}

function makeTab(
  paragraphs: docs_v1.Schema$StructuralElement[],
  extras: Partial<docs_v1.Schema$DocumentTab> = {},
): docs_v1.Schema$DocumentTab {
  return {
    body: { content: paragraphs },
    lists: extras.lists ?? {},
    inlineObjects: extras.inlineObjects ?? {},
    ...extras,
  };
}

const ctx = {
  title: "Test Doc",
  tabTitle: "Tab 0",
  fetchImage: async () => ({ bytes: Buffer.from("png-bytes"), contentType: "image/png" }),
  imagePrefix: "doc1",
  imageDirRelPath: "./figures",
};

describe("convertDocumentTab", () => {
  it("renders headings with the right hash count", async () => {
    const tab = makeTab([
      para("Title", { style: "TITLE" }),
      para("Section", { style: "HEADING_1" }),
      para("Sub-section", { style: "HEADING_2" }),
      para("Body text"),
    ]);
    const out = await convertDocumentTab(tab, ctx);
    expect(out.markdown).toContain("# Title");
    expect(out.markdown).toContain("# Section");
    expect(out.markdown).toContain("## Sub-section");
    expect(out.markdown).toContain("Body text");
  });

  it("preserves bold and italic and code marks", async () => {
    const tab = makeTab([
      para("bold word", { bold: true }),
      para("italic word", { italic: true }),
      para("inline code", { monospace: true }),
    ]);
    const out = await convertDocumentTab(tab, ctx);
    // Whole-paragraph monospace becomes a fenced code block, not inline.
    expect(out.markdown).toContain("**bold word**");
    expect(out.markdown).toContain("*italic word*");
    expect(out.markdown).toContain("```\ninline code\n```");
  });

  it("renders hyperlinks as markdown links", async () => {
    const tab = makeTab([
      para("Battelino et al.", { link: "https://doi.org/10.2337/dci19-0028" }),
    ]);
    const out = await convertDocumentTab(tab, ctx);
    expect(out.markdown).toContain("[Battelino et al.](https://doi.org/10.2337/dci19-0028)");
  });

  it("renders bullet lists with nesting", async () => {
    const tab = makeTab(
      [
        para("first", { bulletListId: "list1", nestingLevel: 0 }),
        para("second", { bulletListId: "list1", nestingLevel: 0 }),
        para("nested", { bulletListId: "list1", nestingLevel: 1 }),
      ],
      {
        lists: {
          list1: {
            listProperties: {
              nestingLevels: [
                { glyphType: "GLYPH_TYPE_UNSPECIFIED" },
                { glyphType: "GLYPH_TYPE_UNSPECIFIED" },
              ],
            },
          },
        },
      },
    );
    const out = await convertDocumentTab(tab, ctx);
    expect(out.markdown).toMatch(/^- first$/m);
    expect(out.markdown).toMatch(/^- second$/m);
    expect(out.markdown).toMatch(/^  - nested$/m);
  });

  it("renders ordered lists with `1.`", async () => {
    const tab = makeTab(
      [
        para("step one", { bulletListId: "list2", nestingLevel: 0 }),
        para("step two", { bulletListId: "list2", nestingLevel: 0 }),
      ],
      {
        lists: {
          list2: {
            listProperties: {
              nestingLevels: [{ glyphType: "DECIMAL" }],
            },
          },
        },
      },
    );
    const out = await convertDocumentTab(tab, ctx);
    expect(out.markdown).toMatch(/^1\. step one$/m);
    expect(out.markdown).toMatch(/^1\. step two$/m);
  });

  it("renders tables as GitHub-flavoured markdown", async () => {
    const tab: docs_v1.Schema$DocumentTab = {
      body: {
        content: [
          {
            table: {
              tableRows: [
                {
                  tableCells: [
                    { content: [para("Tool")] },
                    { content: [para("Description")] },
                  ],
                },
                {
                  tableCells: [
                    { content: [para("cgm_metrics")] },
                    { content: [para("Computes consensus CGM metrics")] },
                  ],
                },
              ],
            },
          },
        ],
      },
      inlineObjects: {},
      lists: {},
    };
    const out = await convertDocumentTab(tab, ctx);
    expect(out.markdown).toContain("| Tool | Description |");
    expect(out.markdown).toContain("| --- | --- |");
    expect(out.markdown).toContain("| cgm_metrics | Computes consensus CGM metrics |");
  });

  it("extracts inline images and emits markdown image links", async () => {
    const tab: docs_v1.Schema$DocumentTab = {
      body: {
        content: [
          para("Caption above image", { style: "NORMAL_TEXT" }),
          {
            paragraph: {
              elements: [
                { inlineObjectElement: { inlineObjectId: "kix.fig1" } },
              ],
            },
          },
        ],
      },
      inlineObjects: {
        "kix.fig1": {
          inlineObjectProperties: {
            embeddedObject: {
              title: "Figure 1: Architecture",
              imageProperties: {
                contentUri: "https://docs.googleusercontent.com/contentUri-fake",
              },
            },
          },
        },
      },
      lists: {},
    };
    const calls: string[] = [];
    const out = await convertDocumentTab(tab, {
      ...ctx,
      fetchImage: async (uri) => {
        calls.push(uri);
        return { bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47]), contentType: "image/png" };
      },
    });
    expect(calls).toEqual(["https://docs.googleusercontent.com/contentUri-fake"]);
    expect(out.images).toHaveLength(1);
    expect(out.images[0].filename).toMatch(/^doc1_figure_1_architecture_[0-9a-f]{8}\.png$/);
    expect(out.images[0].bytes.toString()).toContain("PNG");
    expect(out.markdown).toMatch(/!\[Figure 1: Architecture\]\(\.\/figures\/doc1_figure_1_architecture_[0-9a-f]{8}\.png\)/);
  });

  it("converts cite-cli citation hyperlinks back to pandoc [@key] markers", async () => {
    const tab = makeTab([
      para("See [1]", { link: "https://cite-cli.local/ref/merrill2026" }),
      para("Also [2,3]", { link: "https://cite-cli.local/ref/heydari2025,khasentino2025" }),
    ]);
    const out = await convertDocumentTab(tab, ctx);
    expect(out.markdown).toContain("[@merrill2026]");
    expect(out.markdown).toContain("[@heydari2025; @khasentino2025]");
    // The literal `[1]` / `[2,3]` text must not leak through as a markdown link.
    expect(out.markdown).not.toContain("[[1]]");
    expect(out.markdown).not.toContain("cite-cli.local");
  });

  it("collects warnings for inline objects without contentUri", async () => {
    const tab: docs_v1.Schema$DocumentTab = {
      body: {
        content: [
          {
            paragraph: {
              elements: [{ inlineObjectElement: { inlineObjectId: "kix.linked" } }],
            },
          },
        ],
      },
      inlineObjects: {
        "kix.linked": {
          inlineObjectProperties: {
            embeddedObject: { title: "Linked drawing" },
          },
        },
      },
      lists: {},
    };
    const out = await convertDocumentTab(tab, ctx);
    expect(out.images).toHaveLength(0);
    expect(out.warnings.some((w) => w.includes("kix.linked"))).toBe(true);
  });
});
