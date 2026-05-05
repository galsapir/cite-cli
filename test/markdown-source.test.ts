import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MarkdownDocumentSource } from "../src/lib/markdown-source.js";
import type { CitationStyle, LibraryEntry } from "../src/types/index.js";

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "cite-md-"));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

async function withFile(content: string): Promise<MarkdownDocumentSource> {
  const path = join(workDir, "doc.md");
  await writeFile(path, content, "utf-8");
  return new MarkdownDocumentSource(path);
}

describe("MarkdownDocumentSource", () => {
  it("describes itself with an absolute path", async () => {
    const src = await withFile("# Title\n");
    expect(src.describe()).toContain("markdown:");
    expect(src.describe()).toContain(workDir);
  });

  it("loads academic markdown links and skips non-academic ones", async () => {
    const src = await withFile(
      "Body cites [Battelino](https://doi.org/10.2337/dci19-0028) " +
      "and an [arXiv preprint](https://arxiv.org/abs/2401.06866) " +
      "but ignores [Google](https://www.google.com).\n",
    );
    const out = await src.loadAcademicReferences();
    expect(out.refs).toHaveLength(2);
    expect(out.refs[0].url).toBe("https://doi.org/10.2337/dci19-0028");
    expect(out.refs[0].text).toBe("Battelino");
    expect(out.refs[1].url).toBe("https://arxiv.org/abs/2401.06866");
  });

  it("writes pandoc [@key] markers via descending splice", async () => {
    const src = await withFile(
      "First [Battelino](https://doi.org/10.2337/dci19-0028) " +
      "then [Khasentino](https://doi.org/10.1038/s41591-025-03888-0).\n",
    );
    const loaded = await src.loadAcademicReferences();
    const items = [
      { ref: loaded.refs[0], key: "battelino2019", index: 1 },
      { ref: loaded.refs[1], key: "khasentino2025", index: 2 },
    ];
    const library: LibraryEntry[] = [];
    const outcome = await src.writeScanResults(items, "vancouver" as CitationStyle, library);
    const after = await readFile(src.filePath, "utf-8");
    expect(after).toContain("[@battelino2019]");
    expect(after).toContain("[@khasentino2025]");
    expect(after).not.toContain("https://doi.org/10.2337");
    expect(outcome.occurrenceHandles.battelino2019).toHaveLength(1);
  });

  it("findPresentCitationKeys finds single and multi-key markers", async () => {
    const src = await withFile(
      "See [@one] and [@two] and a multi cite [@three; @four].\n",
    );
    const out = await src.findPresentCitationKeys();
    expect([...out.keys].sort()).toEqual(["four", "one", "three", "two"]);
  });

  it("appends a new bibliography section when none exists", async () => {
    const src = await withFile("# Paper\n\nBody.\n");
    const result = await src.writeBibliography(
      "\n\n1. Smith J. Title. Journal. 2020;1:1.\n",
      {},
    );
    const after = await readFile(src.filePath, "utf-8");
    expect(after).toContain("## References");
    expect(after).toMatch(/1\. Smith J\. Title\. Journal\. 2020;1:1\./);
    expect(result.bibRangeName).toBe("References");
  });

  it("replaces an existing bibliography section in place", async () => {
    const src = await withFile(
      "# Paper\n\nBody.\n\n## References\n\n1. Old reference.\n\n## Appendix\n\nMore.\n",
    );
    await src.writeBibliography("\n\n1. New reference.\n", {});
    const after = await readFile(src.filePath, "utf-8");
    expect(after).toContain("1. New reference.");
    expect(after).not.toContain("Old reference");
    // Appendix section preserved.
    expect(after).toContain("## Appendix");
    expect(after).toContain("More.");
  });

  it("revisionToken changes after a write", async () => {
    const src = await withFile("# A\n");
    const t1 = await src.revisionToken();
    await src.writeBibliography("\n\n1. Ref.\n", {});
    const t2 = await src.revisionToken();
    expect(t1).not.toEqual(t2);
  });
});
