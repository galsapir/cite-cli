// ABOUTME: Verifies insert targets explicit body files in manifest-backed projects.
// ABOUTME: Covers anchor variants, state handles, and manifest/file validation errors.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Command } from "commander";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setupCiteHome, type CiteHome } from "./helpers/cite-home.js";
import { citation, entry } from "./helpers/citation-fixtures.js";
import type { CitationEntry, CitationStyle, LibraryEntry } from "../src/types/index.js";

let env: CiteHome;

beforeEach(async () => { env = await setupCiteHome("cite-insert-manifest-"); });
afterEach(async () => { await env.teardown(); });

describe("insert manifest integration", () => {
  it("resolves --file to a body child and inserts at the anchor", async () => {
    const result = await runInsert({
      files: { "a.md": "A target.\n", "b.md": "B target.\n" },
      file: "b.md",
      args: ["--after", "target.", "--key", "smith"],
      library: [entry("smith")],
    });

    expect(result.filesAfter["a.md"]).toBe("A target.\n");
    expect(result.filesAfter["b.md"]).toBe("B target.[@smith]\n");
    expect(result.after?.citations[0].namedRangeIds).toEqual(["1:9+8"]);
  });

  it("supports paragraph anchors", async () => {
    const result = await runInsert({
      files: { "a.md": "First.\n\nSecond.\n" },
      file: "a.md",
      args: ["--paragraph", "2", "--position", "start", "--key", "smith"],
      library: [entry("smith")],
    });

    expect(result.filesAfter["a.md"]).toBe("First.\n\n[@smith]Second.\n");
  });

  it("errors when --file is not listed in the manifest", async () => {
    const result = await runInsertExpectExit({
      files: { "a.md": "A.\n" },
      file: "missing.md",
      args: ["--after", "A.", "--key", "smith"],
      library: [entry("smith")],
    });

    expect(result.errorOutput).toContain("File 'missing.md' is not listed");
    expect(result.errorOutput).toContain("Available body files:");
    expect(result.errorOutput).toContain("a.md");
  });

  it("errors when --file is the bibliography path", async () => {
    const result = await runInsertExpectExit({
      files: { "a.md": "A.\n" },
      file: "references.md",
      args: ["--after", "A.", "--key", "smith"],
      library: [entry("smith")],
    });

    expect(result.errorOutput).toContain("Inserts into the bibliography aren't supported");
  });

  it("rejects --file without --manifest", async () => {
    const result = await runSingleFileExpectExit(["--markdown", join(env.workDir, "a.md"), "--file", join(env.workDir, "a.md"), "--after", "A.", "--key", "smith"]);
    expect(result.errorOutput).toContain("--file is only valid when the active source is a manifest");
  });

  it("rejects --manifest without --file", async () => {
    const result = await runInsertExpectExit({
      files: { "a.md": "A.\n" },
      args: ["--after", "A.", "--key", "smith"],
      library: [entry("smith")],
    });

    expect(result.errorOutput).toContain("--file is required when using a manifest source");
  });
});

interface InsertFixture {
  files: Record<string, string>;
  file?: string;
  args: string[];
  citations?: CitationEntry[];
  library: LibraryEntry[];
}

interface InsertResult {
  output: string;
  errorOutput: string;
  filesAfter: Record<string, string>;
  after: Awaited<ReturnType<typeof import("../src/lib/doc-state.js").loadDocState>>;
}

async function runInsert(fixture: InsertFixture): Promise<InsertResult> {
  return runInsertFixture(fixture, false);
}

async function runInsertExpectExit(fixture: InsertFixture): Promise<InsertResult> {
  return runInsertFixture(fixture, true);
}

async function runInsertFixture(fixture: InsertFixture, expectExit: boolean): Promise<InsertResult> {
  const manifestPath = await writeProject(fixture.files);
  const { initDocStateForManifest, loadDocState, saveDocState } = await import("../src/lib/doc-state.js");
  const { saveLibrary } = await import("../src/lib/library.js");
  const state = await initDocStateForManifest(manifestPath, "local", "vancouver" as CitationStyle);
  state.citations = fixture.citations ?? [];
  await saveDocState(state);
  await saveLibrary("local", fixture.library);

  const argv = ["--manifest", manifestPath, "--yes", ...fixture.args];
  if (fixture.file) {
    const fileArg = fixture.file in fixture.files || fixture.file === "references.md"
      ? join(env.workDir, fixture.file)
      : fixture.file;
    argv.push("--file", fileArg);
  }
  const { output, errorOutput } = await executeInsert(argv, expectExit);
  const filesAfter: Record<string, string> = {};
  for (const file of Object.keys(fixture.files)) filesAfter[file] = await readFile(join(env.workDir, file), "utf-8");
  return { output, errorOutput, filesAfter, after: await loadDocState(state.docId) };
}

async function runSingleFileExpectExit(args: string[]): Promise<{ errorOutput: string }> {
  await writeFile(join(env.workDir, "a.md"), "A.\n", "utf-8");
  const { initDocStateForMarkdown, saveDocState } = await import("../src/lib/doc-state.js");
  const { saveLibrary } = await import("../src/lib/library.js");
  const state = await initDocStateForMarkdown(join(env.workDir, "a.md"), "local", "vancouver" as CitationStyle);
  await saveDocState(state);
  await saveLibrary("local", [entry("smith")]);
  return executeInsert(["--yes", ...args], true);
}

async function executeInsert(args: string[], expectExit: boolean): Promise<{ output: string; errorOutput: string }> {
  const { registerInsertCommand } = await import("../src/commands/insert.js");
  const logs: string[] = [];
  const errors: string[] = [];
  vi.spyOn(console, "log").mockImplementation((message = "") => { logs.push(String(message)); });
  vi.spyOn(console, "error").mockImplementation((message = "") => { errors.push(String(message)); });
  const exit = vi.spyOn(process, "exit").mockImplementation((() => { throw new Error("process.exit"); }) as never);

  const program = new Command();
  program.exitOverride();
  registerInsertCommand(program);
  const argv = ["node", "cite", "insert", ...args];
  if (expectExit) {
    await expect(program.parseAsync(argv)).rejects.toThrow("process.exit");
  } else {
    await program.parseAsync(argv);
  }
  exit.mockRestore();
  return { output: logs.join("\n"), errorOutput: errors.join("\n") };
}

async function writeProject(files: Record<string, string>): Promise<string> {
  for (const [relativePath, text] of Object.entries(files)) await writeFile(join(env.workDir, relativePath), text, "utf-8");
  await writeFile(join(env.workDir, "references.md"), "", "utf-8");
  const manifestPath = join(env.workDir, "cite.manifest.yaml");
  await writeFile(manifestPath, `files:\n${Object.keys(files).map((file) => `  - ${file}`).join("\n")}\nbibliography: references.md\n`, "utf-8");
  return manifestPath;
}
