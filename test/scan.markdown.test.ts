// ABOUTME: Verifies that the markdown-source scan path lays the right edits via the DocumentSource interface.
// ABOUTME: Exercises the integration between MarkdownDocumentSource and the data shapes scan.ts uses.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MarkdownDocumentSource } from "../src/lib/markdown-source.js";
import type { CitationStyle, LibraryEntry } from "../src/types/index.js";

let workDir: string;
beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "cite-scan-md-"));
});
afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

describe("scan markdown integration", () => {
  it("converts a markdown file's academic links into [@key] markers and tracks occurrence handles", async () => {
    const path = join(workDir, "draft.md");
    await writeFile(
      path,
      "Intro cites [Battelino et al.](https://doi.org/10.2337/dci19-0028) and " +
      "[Khasentino et al.](https://doi.org/10.1038/s41591-025-03888-0).\n",
      "utf-8",
    );

    const source = new MarkdownDocumentSource(path);
    const loaded = await source.loadAcademicReferences();
    expect(loaded.refs).toHaveLength(2);

    const writeItems = loaded.refs.map((ref, i) => ({
      ref,
      key: `key${i + 1}`,
      index: i + 1,
    }));
    const library: LibraryEntry[] = [];
    const outcome = await source.writeScanResults(writeItems, "vancouver" as CitationStyle, library);

    const after = await readFile(path, "utf-8");
    expect(after).toContain("[@key1]");
    expect(after).toContain("[@key2]");
    expect(after).not.toContain("doi.org/10.2337");
    expect(after).not.toContain("doi.org/10.1038");
    expect(outcome.occurrenceHandles.key1).toHaveLength(1);
    expect(outcome.occurrenceHandles.key2).toHaveLength(1);
    expect(outcome.newRevisionToken).not.toEqual(loaded.revisionToken);
  });

  it("findPresentCitationKeys after scan recovers the inserted keys", async () => {
    const path = join(workDir, "draft.md");
    await writeFile(
      path,
      "See [Smith](https://doi.org/10.1234/abcd).\n",
      "utf-8",
    );
    const source = new MarkdownDocumentSource(path);
    const loaded = await source.loadAcademicReferences();
    await source.writeScanResults(
      [{ ref: loaded.refs[0], key: "smith2024", index: 1 }],
      "vancouver" as CitationStyle,
      [],
    );
    const present = await source.findPresentCitationKeys();
    expect([...present.keys]).toEqual(["smith2024"]);
  });
});
