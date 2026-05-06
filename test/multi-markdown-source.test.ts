// ABOUTME: Verifies multi-file markdown DocumentSource composition.
// ABOUTME: Covers revision tokens, cursor wrapping, and manifest-aware writes.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadManifest } from "../src/lib/manifest.js";
import { ManifestPartialWriteError, MultiMarkdownDocumentSource, type MultiMarkdownCursor } from "../src/lib/multi-markdown-source.js";
import type { CitationStyle } from "../src/types/index.js";

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "cite-multi-md-"));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

async function writeFileInDir(relativePath: string, content: string): Promise<string> {
  const filePath = resolve(workDir, relativePath);
  await writeFile(filePath, content, "utf-8");
  return filePath;
}

async function sourceFromManifest(text: string): Promise<MultiMarkdownDocumentSource> {
  const manifestPath = join(workDir, "cite.manifest.yaml");
  await writeFile(manifestPath, text, "utf-8");
  return new MultiMarkdownDocumentSource(await loadManifest(manifestPath));
}

describe("MultiMarkdownDocumentSource", () => {
  it("describes itself with the absolute manifest path", async () => {
    await writeFileInDir("a.md", "# A\n");
    const source = await sourceFromManifest("files:\n  - a.md\nbibliography: references.md\n");
    expect(source.describe()).toBe(`markdown-manifest:${resolve(workDir, "cite.manifest.yaml")}`);
  });

  it("returns a deterministic revision token for unchanged files", async () => {
    await writeFileInDir("a.md", "# A\n");
    await writeFileInDir("references.md", "# Refs\n");
    const source = await sourceFromManifest("files:\n  - a.md\nbibliography: references.md\n");
    await expect(source.revisionToken()).resolves.toBe(await source.revisionToken());
  });

  it("changes revision token when a body file changes", async () => {
    await writeFileInDir("a.md", "# A\n");
    const source = await sourceFromManifest("files:\n  - a.md\nbibliography: references.md\n");
    const before = await source.revisionToken();
    await writeFileInDir("a.md", "# A changed\n");
    await expect(source.revisionToken()).resolves.not.toBe(before);
  });

  it("changes revision token when the bibliography file changes", async () => {
    await writeFileInDir("a.md", "# A\n");
    await writeFileInDir("references.md", "# Refs\n");
    const source = await sourceFromManifest("files:\n  - a.md\nbibliography: references.md\n");
    const before = await source.revisionToken();
    await writeFileInDir("references.md", "# Refs changed\n");
    await expect(source.revisionToken()).resolves.not.toBe(before);
  });

  it("changes revision token when the manifest text changes", async () => {
    await writeFileInDir("a.md", "# A\n");
    const source = await sourceFromManifest("files:\n  - a.md\nbibliography: references.md\n");
    const before = await source.revisionToken();
    await writeFile(resolve(workDir, "cite.manifest.yaml"), "files:\n  - a.md\nbibliography: references.md\n\n", "utf-8");
    await expect(source.revisionToken()).resolves.not.toBe(before);
  });

  it("loads academic references from body files only with wrapped cursors", async () => {
    await writeFileInDir("a.md", "A [One](https://doi.org/10.1000/a).\n");
    await writeFileInDir("b.md", "B [Two](https://arxiv.org/abs/2401.06866).\n");
    await writeFileInDir("references.md", "Bib [Ignored](https://doi.org/10.1000/bib).\n");
    const source = await sourceFromManifest("files:\n  - a.md\n  - b.md\n  - references.md\nbibliography: references.md\n");

    const out = await source.loadAcademicReferences();
    expect(out.refs.map((ref) => ref.url)).toEqual([
      "https://doi.org/10.1000/a",
      "https://arxiv.org/abs/2401.06866",
    ]);
    expect(out.refs.map((ref) => (ref.cursor as MultiMarkdownCursor).fileIdx)).toEqual([0, 1]);
    expect((out.refs[0].cursor as MultiMarkdownCursor).child).toEqual(expect.objectContaining({ start: expect.any(Number), end: expect.any(Number) }));
  });

  it("returns the composite revision token with loaded references", async () => {
    await writeFileInDir("a.md", "A [One](https://doi.org/10.1000/a).\n");
    const source = await sourceFromManifest("files:\n  - a.md\nbibliography: references.md\n");
    const out = await source.loadAcademicReferences();
    expect(out.revisionToken).toBe(await source.revisionToken());
  });

  it("unions present citation keys from body files only", async () => {
    await writeFileInDir("a.md", "A [@one; @two].\n");
    await writeFileInDir("b.md", "B [@two] and [@three].\n");
    await writeFileInDir("references.md", "Bib [@ignored].\n");
    const source = await sourceFromManifest("files:\n  - a.md\n  - b.md\n  - references.md\nbibliography: references.md\n");
    const out = await source.findPresentCitationKeys();
    expect([...out.keys].sort()).toEqual(["one", "three", "two"]);
  });

  it("writes scan results to the correct body files", async () => {
    await writeFileInDir("a.md", "A [One](https://doi.org/10.1000/a).\n");
    await writeFileInDir("b.md", "B [Two](https://doi.org/10.1000/b).\n");
    const source = await sourceFromManifest("files:\n  - a.md\n  - b.md\nbibliography: references.md\n");
    const loaded = await source.loadAcademicReferences();

    const outcome = await source.writeScanResults(
      [
        { ref: loaded.refs[0], key: "one2024", index: 1 },
        { ref: loaded.refs[1], key: "two2024", index: 2 },
      ],
      "vancouver" as CitationStyle,
      [],
    );

    await expect(readFile(resolve(workDir, "a.md"), "utf-8")).resolves.toContain("[@one2024]");
    await expect(readFile(resolve(workDir, "b.md"), "utf-8")).resolves.toContain("[@two2024]");
    expect(outcome.occurrenceHandles.one2024[0]).toMatch(/^0:\d+\+\d+$/);
    expect(outcome.occurrenceHandles.two2024[0]).toMatch(/^1:\d+\+\d+$/);
  });

  it("returns the composite revision token after scan writes", async () => {
    await writeFileInDir("a.md", "A [One](https://doi.org/10.1000/a).\n");
    const source = await sourceFromManifest("files:\n  - a.md\nbibliography: references.md\n");
    const loaded = await source.loadAcademicReferences();

    const outcome = await source.writeScanResults(
      [{ ref: loaded.refs[0], key: "one2024", index: 1 }],
      "vancouver" as CitationStyle,
      [],
    );

    expect(outcome.newRevisionToken).toBe(await source.revisionToken());
  });

  it("creates a missing bibliography file and writes the references section", async () => {
    await writeFileInDir("a.md", "# A\n");
    const source = await sourceFromManifest("files:\n  - a.md\nbibliography: references.md\n");

    await source.writeBibliography("\n\n1. First ref.\n", {});

    await expect(readFile(resolve(workDir, "references.md"), "utf-8")).resolves.toContain("## References\n\n1. First ref.");
  });

  it("replaces an existing bibliography section without touching body files", async () => {
    await writeFileInDir("a.md", "# A\n\nBody.\n");
    await writeFileInDir("references.md", "# Bibliography\n\n## References\n\n1. Old ref.\n");
    const source = await sourceFromManifest("files:\n  - a.md\nbibliography: references.md\n");

    const outcome = await source.writeBibliography("\n\n1. New ref.\n", {});

    await expect(readFile(resolve(workDir, "a.md"), "utf-8")).resolves.toBe("# A\n\nBody.\n");
    await expect(readFile(resolve(workDir, "references.md"), "utf-8")).resolves.toContain("1. New ref.");
    await expect(readFile(resolve(workDir, "references.md"), "utf-8")).resolves.not.toContain("Old ref");
    expect(outcome.newRevisionToken).toBe(await source.revisionToken());
  });

  it("reports partial scan writes with failure context", async () => {
    await writeFileInDir("a.md", "A [One](https://doi.org/10.1000/a).\n");
    await writeFileInDir("b.md", "B [Two](https://doi.org/10.1000/b).\n");
    const source = await sourceFromManifest("files:\n  - a.md\n  - b.md\nbibliography: references.md\n");
    const loaded = await source.loadAcademicReferences();
    source.bodyChildren[1].writeScanResults = async () => {
      throw new Error("simulated write failure");
    };

    const write = source.writeScanResults(
      [
        { ref: loaded.refs[0], key: "one2024", index: 1 },
        { ref: loaded.refs[1], key: "two2024", index: 2 },
      ],
      "vancouver" as CitationStyle,
      [],
    );

    await expect(write).rejects.toThrow(ManifestPartialWriteError);
    await expect(write).rejects.toThrow(/Wrote 1 of 2 files\. Failed at .*b\.md: simulated write failure/);
    await expect(readFile(resolve(workDir, "a.md"), "utf-8")).resolves.toContain("[@one2024]");
  });

  it("indexes bodyChildren when bibliography is listed under files", async () => {
    await writeFileInDir("a.md", "A [One](https://doi.org/10.1000/a).\n");
    await writeFileInDir("b.md", "B [Two](https://doi.org/10.1000/b).\n");
    await writeFileInDir("references.md", "# Refs\n");
    const source = await sourceFromManifest("files:\n  - a.md\n  - b.md\n  - references.md\nbibliography: references.md\n");
    const out = await source.loadAcademicReferences();
    expect(source.bodyChildren).toHaveLength(2);
    expect(out.refs.map((ref) => (ref.cursor as MultiMarkdownCursor).fileIdx)).toEqual([0, 1]);
  });

  it("keeps bibliography standalone when it is not listed under files", async () => {
    await writeFileInDir("a.md", "# A\n");
    await writeFileInDir("b.md", "# B\n");
    const source = await sourceFromManifest("files:\n  - a.md\n  - b.md\nbibliography: references.md\n");
    expect(source.bodyChildren).toHaveLength(2);
    expect(source.bibChild.filePath).toBe(resolve(workDir, "references.md"));
    await expect(readFile(source.bibChild.filePath, "utf-8")).rejects.toMatchObject({ code: "ENOENT" });
  });
});
