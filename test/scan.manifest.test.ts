// ABOUTME: Verifies cite scan behavior for manifest-backed markdown projects.
// ABOUTME: Exercises command wiring, cross-file dedupe, and default manifest resolution.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Command } from "commander";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setupCiteHome, type CiteHome } from "./helpers/cite-home.js";
import type { CslJson } from "../src/types/index.js";

let env: CiteHome;
let workDir: string;

beforeEach(async () => {
  env = await setupCiteHome("cite-scan-manifest-home-");
  workDir = await mkdtemp(join(tmpdir(), "cite-scan-manifest-"));
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
  await env.teardown();
  await rm(workDir, { recursive: true, force: true });
});

describe("scan manifest integration", () => {
  it("scans body files only and inserts markers at URL positions", async () => {
    const manifestPath = await writeManifest({
      a: "A [One](https://doi.org/10.1000/a).\n",
      b: "B [Two](https://doi.org/10.1000/b).\n",
      refs: "Refs [Ignored](https://doi.org/10.1000/refs).\n",
      manifest: "files:\n  - a.md\n  - b.md\n  - references.md\nbibliography: references.md\n",
    });
    await initManifestState(manifestPath);

    await runScan(["--manifest", manifestPath, "-y"]);

    await expect(readFile(join(workDir, "a.md"), "utf-8")).resolves.toContain("[@a2024]");
    await expect(readFile(join(workDir, "b.md"), "utf-8")).resolves.toContain("[@b2024]");
    await expect(readFile(join(workDir, "references.md"), "utf-8")).resolves.toContain("doi.org/10.1000/refs");
  });

  it("dedupes the same DOI across body files", async () => {
    const manifestPath = await writeManifest({
      a: "A [One](https://doi.org/10.1000/same).\n",
      b: "B [Two](https://doi.org/10.1000/same).\n",
      manifest: "files:\n  - a.md\n  - b.md\nbibliography: references.md\n",
    });
    const stateKey = await initManifestState(manifestPath);

    await runScan(["--manifest", manifestPath, "-y"]);

    const { loadLibrary } = await import("../src/lib/library.js");
    const { loadDocState } = await import("../src/lib/doc-state.js");
    const library = await loadLibrary("library-1");
    const state = await loadDocState(stateKey);
    expect(library.map((entry) => entry.key)).toEqual(["same2024"]);
    expect(state?.citations).toHaveLength(1);
    expect(state?.citations[0].namedRangeIds).toHaveLength(2);
    await expect(readFile(join(workDir, "a.md"), "utf-8")).resolves.toContain("[@same2024]");
    await expect(readFile(join(workDir, "b.md"), "utf-8")).resolves.toContain("[@same2024]");
  });

  it("does not duplicate handles when re-scanning a key that already exists in state", async () => {
    // Two body files contain unprocessed URLs that resolve to a key already
    // tracked in docState. The state-update loop must fold handles by key
    // (not per-resolved-ref), or the existing citation accumulates duplicate
    // ${fileIdx}:${handle} entries.
    const manifestPath = await writeManifest({
      a: "A [One](https://doi.org/10.1000/same).\n",
      b: "B [Two](https://doi.org/10.1000/same).\n",
      manifest: "files:\n  - a.md\n  - b.md\nbibliography: references.md\n",
    });
    const stateKey = await initManifestState(manifestPath);

    // Pre-seed docState as if "same2024" were already tracked from a prior run.
    const { loadDocState, saveDocState } = await import("../src/lib/doc-state.js");
    const seeded = await loadDocState(stateKey);
    seeded!.citations.push({
      index: 1,
      key: "same2024",
      location: "manual",
      namedRangeIds: ["pre-existing-handle"],
    });
    await saveDocState(seeded!);

    await runScan(["--manifest", manifestPath, "-y"]);

    const state = await loadDocState(stateKey);
    expect(state?.citations).toHaveLength(1);
    // Existing 1 handle + 2 new (one per body file) = 3 total. Without the
    // dedupe guard this would be 1 + 4 (handles pushed twice).
    expect(state?.citations[0].namedRangeIds).toHaveLength(3);
    expect(state?.citations[0].namedRangeIds).toContain("pre-existing-handle");
  });

  it("reports no URLs for an empty files manifest without writes", async () => {
    const manifestPath = join(workDir, "cite.manifest.yaml");
    await writeFile(manifestPath, "files: []\nbibliography: references.md\n", "utf-8");
    await initManifestState(manifestPath);
    const logs = captureLogs();

    await runScan(["--manifest", manifestPath, "-y"]);

    expect(logs.join("\n")).toContain("No unprocessed reference URLs found in document.");
  });

  it("does not write when body files already contain citations", async () => {
    const manifestPath = await writeManifest({
      a: "A [@one2024].\n",
      manifest: "files:\n  - a.md\nbibliography: references.md\n",
    });
    await initManifestState(manifestPath);
    const before = await readFile(join(workDir, "a.md"), "utf-8");

    await runScan(["--manifest", manifestPath, "-y"]);

    await expect(readFile(join(workDir, "a.md"), "utf-8")).resolves.toBe(before);
  });

  it("uses defaults.manifest when no source flags are passed", async () => {
    const manifestPath = await writeManifest({
      a: "A [One](https://doi.org/10.1000/a).\n",
      manifest: "files:\n  - a.md\nbibliography: references.md\n",
    });
    await initManifestState(manifestPath);
    const { updateConfig } = await import("../src/lib/config.js");
    await updateConfig({ defaults: { manifest: manifestPath } });

    await runScan(["-y"]);

    await expect(readFile(join(workDir, "a.md"), "utf-8")).resolves.toContain("[@a2024]");
  });
});

async function writeManifest(input: { a?: string; b?: string; refs?: string; manifest: string }): Promise<string> {
  if (input.a !== undefined) await writeFile(join(workDir, "a.md"), input.a, "utf-8");
  if (input.b !== undefined) await writeFile(join(workDir, "b.md"), input.b, "utf-8");
  if (input.refs !== undefined) await writeFile(join(workDir, "references.md"), input.refs, "utf-8");
  const manifestPath = join(workDir, "cite.manifest.yaml");
  await writeFile(manifestPath, input.manifest, "utf-8");
  return manifestPath;
}

async function initManifestState(manifestPath: string): Promise<string> {
  const { initDocStateForManifest } = await import("../src/lib/doc-state.js");
  const state = await initDocStateForManifest(manifestPath, "library-1", "vancouver");
  return state.docId;
}

async function runScan(args: string[]): Promise<void> {
  vi.doMock("../src/lib/resolver.js", () => ({
    canonicalIds: (csl: CslJson) => csl.DOI ? [`doi:${String(csl.DOI).toLowerCase()}`] : [],
    resolve: async (url: string) => {
      const doi = url.replace(/^https:\/\/doi\.org\//, "");
      const suffix = doi.split("/").pop() ?? "ref";
      return {
        suggestedKey: `${suffix}2024`,
        csl: {
          id: suffix,
          type: "article-journal",
          title: `Paper ${suffix}`,
          author: [{ given: "Ada", family: suffix }],
          issued: { "date-parts": [[2024]] },
          DOI: doi,
        },
      };
    },
  }));
  vi.doMock("../src/lib/zotero.js", () => ({
    addToZotero: async () => undefined,
    getCollectionName: async () => undefined,
    resolveCollectionKey: async () => undefined,
  }));
  const { registerScanCommand } = await import("../src/commands/scan.js");
  const program = new Command();
  program.exitOverride();
  registerScanCommand(program);
  await program.parseAsync(["node", "cite", "scan", ...args]);
}

function captureLogs(): string[] {
  const logs: string[] = [];
  vi.mocked(console.log).mockImplementation((message = "") => {
    logs.push(String(message));
  });
  return logs;
}
