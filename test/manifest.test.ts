// ABOUTME: Verifies YAML manifest loading and validation rules.
// ABOUTME: Covers path resolution, duplicate detection, and missing-file handling.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadManifest, ManifestLoadError } from "../src/lib/manifest.js";

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "cite-manifest-"));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

async function writeManifest(text: string): Promise<string> {
  const manifestPath = join(workDir, "cite.manifest.yaml");
  await writeFile(manifestPath, text, "utf-8");
  return manifestPath;
}

async function touch(relativePath: string, content = "# Body\n"): Promise<string> {
  const filePath = resolve(workDir, relativePath);
  await writeFile(filePath, content, "utf-8");
  return filePath;
}

describe("loadManifest", () => {
  it("loads a valid manifest with bibliography listed under files", async () => {
    const a = await touch("00-abstract.md");
    const b = await touch("01-intro.md");
    const bib = await touch("references.md");
    const manifestPath = await writeManifest(
      "files:\n  - 00-abstract.md\n  - 01-intro.md\n  - references.md\nbibliography: references.md\n",
    );

    await expect(loadManifest(manifestPath)).resolves.toEqual({
      manifestPath: resolve(manifestPath),
      manifestDir: workDir,
      bodyFilePaths: [a, b],
      bibFilePath: bib,
    });
  });

  it("loads a valid manifest with standalone bibliography", async () => {
    const a = await touch("a.md");
    const b = await touch("b.md");
    const manifestPath = await writeManifest(
      "files:\n  - a.md\n  - b.md\nbibliography: references.md\n",
    );

    const manifest = await loadManifest(manifestPath);
    expect(manifest.bodyFilePaths).toEqual([a, b]);
    expect(manifest.bibFilePath).toBe(resolve(workDir, "references.md"));
  });

  it("errors when the manifest file is missing", async () => {
    const manifestPath = resolve(workDir, "missing.yaml");
    await expect(loadManifest(manifestPath)).rejects.toThrow(ManifestLoadError);
    await expect(loadManifest(manifestPath)).rejects.toThrow(
      `Manifest not found at ${manifestPath}. Run 'cite init --manifest <path>' to create one.`,
    );
  });

  it("errors when the manifest is malformed YAML", async () => {
    const manifestPath = await writeManifest("files: [unterminated\n");
    await expect(loadManifest(manifestPath)).rejects.toThrow(ManifestLoadError);
    await expect(loadManifest(manifestPath)).rejects.toThrow(/not valid YAML: .+Fix the syntax error and re-run\./);
  });

  it("errors when files is missing", async () => {
    const manifestPath = await writeManifest("bibliography: references.md\n");
    await expect(loadManifest(manifestPath)).rejects.toThrow(/missing required key 'files'/);
  });

  it("errors when bibliography is missing", async () => {
    const manifestPath = await writeManifest("files: []\n");
    await expect(loadManifest(manifestPath)).rejects.toThrow(/missing required key 'bibliography'/);
  });

  it("allows empty files", async () => {
    const manifestPath = await writeManifest("files: []\nbibliography: references.md\n");
    const manifest = await loadManifest(manifestPath);
    expect(manifest.bodyFilePaths).toEqual([]);
  });

  it("rejects absolute paths in files", async () => {
    const absEntry = resolve(workDir, "a.md");
    const manifestPath = await writeManifest(`files:\n  - ${absEntry}\nbibliography: references.md\n`);
    await expect(loadManifest(manifestPath)).rejects.toThrow(
      `Manifest entry '${absEntry}' is an absolute path; manifest paths must be relative to ${workDir}.`,
    );
  });

  it("allows parent-directory entries", async () => {
    const siblingPath = resolve(workDir, "..", "sibling.md");
    await writeFile(siblingPath, "# Sibling\n", "utf-8");
    const manifestPath = await writeManifest("files:\n  - ../sibling.md\nbibliography: references.md\n");
    const manifest = await loadManifest(manifestPath);
    expect(manifest.bodyFilePaths).toEqual([siblingPath]);
  });

  it("rejects duplicate file entries", async () => {
    await touch("a.md");
    const manifestPath = await writeManifest("files:\n  - a.md\n  - a.md\nbibliography: references.md\n");
    await expect(loadManifest(manifestPath)).rejects.toThrow(
      `Manifest ${resolve(manifestPath)} lists 'a.md' twice. Each file may appear at most once under 'files:'.`,
    );
  });

  it("rejects different entries that resolve to the same path", async () => {
    await touch("a.md");
    const manifestPath = await writeManifest("files:\n  - ./a.md\n  - a.md\nbibliography: references.md\n");
    await expect(loadManifest(manifestPath)).rejects.toThrow(/lists 'a\.md' twice/);
  });

  it("errors when a listed file is missing", async () => {
    const manifestPath = await writeManifest("files:\n  - missing.md\nbibliography: references.md\n");
    await expect(loadManifest(manifestPath)).rejects.toThrow(
      `Manifest entry 'missing.md' resolves to ${resolve(workDir, "missing.md")} which does not exist. Create the file or remove the entry.`,
    );
  });

  it("allows missing standalone bibliography file", async () => {
    await touch("a.md");
    const manifestPath = await writeManifest("files:\n  - a.md\nbibliography: references.md\n");
    const manifest = await loadManifest(manifestPath);
    expect(manifest.bibFilePath).toBe(resolve(workDir, "references.md"));
  });

  it("errors when a listed bibliography file is missing", async () => {
    const manifestPath = await writeManifest("files:\n  - references.md\nbibliography: references.md\n");
    await expect(loadManifest(manifestPath)).rejects.toThrow(/Manifest entry 'references\.md' resolves to .* does not exist/);
  });

  it("errors when files is not an array", async () => {
    const manifestPath = await writeManifest("files: a.md\nbibliography: references.md\n");
    await expect(loadManifest(manifestPath)).rejects.toThrow(/'files' must be an array/);
  });

  it("errors when files contains non-string entries", async () => {
    const manifestPath = await writeManifest("files:\n  - a.md\n  - 3\nbibliography: references.md\n");
    await expect(loadManifest(manifestPath)).rejects.toThrow(/files\[1\] must be a string/);
  });

  it("errors when bibliography is not a string", async () => {
    const manifestPath = await writeManifest("files: []\nbibliography:\n  path: references.md\n");
    await expect(loadManifest(manifestPath)).rejects.toThrow(/'bibliography' must be a string/);
  });
});
