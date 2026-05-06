// ABOUTME: Verifies cite bib behavior for manifest-backed markdown projects.
// ABOUTME: Covers bibliography targeting, auto-create, and style override wiring.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Command } from "commander";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setupCiteHome, type CiteHome } from "./helpers/cite-home.js";
import type { LibraryEntry } from "../src/types/index.js";

let env: CiteHome;
let workDir: string;

beforeEach(async () => {
  env = await setupCiteHome("cite-bib-manifest-home-");
  workDir = await mkdtemp(join(tmpdir(), "cite-bib-manifest-"));
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
  await env.teardown();
  await rm(workDir, { recursive: true, force: true });
});

describe("bib manifest integration", () => {
  it("writes an existing bibliography file listed in files without touching body files", async () => {
    const manifestPath = await writeProject({
      body: "Body [@one2024].\n",
      refs: "# Refs\n\n## References\n\n1. Old ref.\n",
      manifest: "files:\n  - body.md\n  - references.md\nbibliography: references.md\n",
    });
    await initStateAndLibrary(manifestPath);

    await runBib(["--manifest", manifestPath, "-y"]);

    await expect(readFile(join(workDir, "body.md"), "utf-8")).resolves.toBe("Body [@one2024].\n");
    const refs = await readFile(join(workDir, "references.md"), "utf-8");
    expect(refs).toContain("## References");
    expect(refs).toContain("1. Adams A. First paper. Journal A. 2020.");
    expect(refs).not.toContain("Old ref");
  });

  it("auto-creates a standalone missing bibliography file", async () => {
    const manifestPath = await writeProject({
      body: "Body [@one2024].\n",
      manifest: "files:\n  - body.md\nbibliography: references.md\n",
    });
    await initStateAndLibrary(manifestPath);

    await runBib(["--manifest", manifestPath, "-y"]);

    await expect(readFile(join(workDir, "body.md"), "utf-8")).resolves.toBe("Body [@one2024].\n");
    await expect(readFile(join(workDir, "references.md"), "utf-8")).resolves.toContain("## References");
  });

  it("uses --style over doc state style for bibliography output", async () => {
    const manifestPath = await writeProject({
      body: "Body [@one2024].\n",
      manifest: "files:\n  - body.md\nbibliography: references.md\n",
    });
    await initStateAndLibrary(manifestPath);

    await runBib(["--manifest", manifestPath, "--style", "apa", "-y"]);

    const refs = await readFile(join(workDir, "references.md"), "utf-8");
    expect(refs).toContain("Adams, A. (2020). First paper. Journal A.");
    expect(refs).not.toContain("1. Adams A.");
  });

  it("warns and leaves an existing bibliography untouched when no citations remain", async () => {
    const refsBefore = "## References\n\n1. Old entry.\n";
    const manifestPath = await writeProject({
      body: "Body without citations.\n",
      refs: refsBefore,
      manifest: "files:\n  - body.md\nbibliography: references.md\n",
    });
    await initEmptyState(manifestPath);

    const output = await runBibWithOutput(["--manifest", manifestPath, "-y"]);

    expect(output).toContain(`Warning: The bibliography section in ${join(workDir, "references.md")} still contains entries from a previous run.`);
    expect(output).toContain("No citations remain in the manuscript; the bibliography file was NOT modified automatically.");
    await expect(readFile(join(workDir, "references.md"), "utf-8")).resolves.toBe(refsBefore);
  });

  it("does not warn when no citations remain and the bibliography file is missing", async () => {
    const manifestPath = await writeProject({
      body: "Body without citations.\n",
      manifest: "files:\n  - body.md\nbibliography: references.md\n",
    });
    await initEmptyState(manifestPath);

    const output = await runBibWithOutput(["--manifest", manifestPath, "-y"]);

    expect(output).toContain("No citations in this document. Use 'cite scan' or 'cite insert' first.");
    expect(output).not.toContain("bibliography file was NOT modified automatically");
  });
});

async function writeProject(input: { body: string; refs?: string; manifest: string }): Promise<string> {
  await writeFile(join(workDir, "body.md"), input.body, "utf-8");
  if (input.refs !== undefined) await writeFile(join(workDir, "references.md"), input.refs, "utf-8");
  const manifestPath = join(workDir, "cite.manifest.yaml");
  await writeFile(manifestPath, input.manifest, "utf-8");
  return manifestPath;
}

async function initStateAndLibrary(manifestPath: string): Promise<void> {
  const { initDocStateForManifest } = await import("../src/lib/doc-state.js");
  const { saveLibrary } = await import("../src/lib/library.js");
  const state = await initDocStateForManifest(manifestPath, "library-1", "vancouver");
  state.citations.push({ index: 1, key: "one2024", location: "scan:https://doi.org/10.1000/a" });
  const { saveDocState } = await import("../src/lib/doc-state.js");
  await saveDocState(state);
  const entry: LibraryEntry = {
    key: "one2024",
    addedAt: new Date().toISOString(),
    csl: {
      id: "one2024",
      type: "article-journal",
      title: "First paper",
      author: [{ given: "Alice", family: "Adams" }],
      issued: { "date-parts": [[2020]] },
      "container-title": "Journal A",
    },
  };
  await saveLibrary("library-1", [entry]);
}

async function initEmptyState(manifestPath: string): Promise<void> {
  const { initDocStateForManifest } = await import("../src/lib/doc-state.js");
  await initDocStateForManifest(manifestPath, "library-1", "vancouver");
}

async function runBib(args: string[]): Promise<void> {
  await runBibWithOutput(args);
}

async function runBibWithOutput(args: string[]): Promise<string> {
  const logs: string[] = [];
  vi.spyOn(console, "log").mockImplementation((message = "") => { logs.push(String(message)); });
  const { registerBibCommand } = await import("../src/commands/bib.js");
  const program = new Command();
  program.exitOverride();
  registerBibCommand(program);
  await program.parseAsync(["node", "cite", "bib", ...args]);
  return logs.join("\n");
}
