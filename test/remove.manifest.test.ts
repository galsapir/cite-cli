// ABOUTME: Verifies remove rewrites citations across manifest-backed markdown files.
// ABOUTME: Covers state cleanup, no-op behavior, bibliography, and per-file output.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Command } from "commander";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setupCiteHome, type CiteHome } from "./helpers/cite-home.js";
import { citation, entry } from "./helpers/citation-fixtures.js";
import type { CitationEntry, CitationStyle, LibraryEntry } from "../src/types/index.js";

let env: CiteHome;

beforeEach(async () => { env = await setupCiteHome("cite-remove-manifest-"); });
afterEach(async () => { await env.teardown(); });

describe("remove manifest integration", () => {
  it("removes a key from all body files and bibliography", async () => {
    const result = await runRemove({
      files: { "a.md": "A [@smith] [@kept].\n", "b.md": "B [@smith].\n" },
      refs: "Refs [@smith].\n",
      key: "smith",
      citations: [citation(1, "smith"), citation(2, "kept")],
      library: [entry("smith"), entry("kept")],
    });

    expect(result.filesAfter["a.md"]).toBe("A [@kept].\n");
    expect(result.filesAfter["b.md"]).toBe("B.\n");
    expect(result.refsAfter).toBe("Refs.\n");
  });

  it("drops the state entry", async () => {
    const result = await runRemove({
      files: { "a.md": "A [@smith] [@kept].\n" },
      key: "smith",
      citations: [citation(1, "smith"), citation(2, "kept")],
      library: [entry("smith"), entry("kept")],
    });

    expect(result.after?.citations).toEqual([citation(1, "kept")]);
  });

  it("does not mutate state for an absent key", async () => {
    const result = await runRemove({
      files: { "a.md": "A [@kept].\n" },
      key: "smith",
      citations: [citation(1, "kept")],
      library: [entry("kept")],
    });

    expect(result.output).toContain("Key 'smith' not found in any manifest file or state.");
    expect(result.after).toEqual(result.before);
  });

  it("reports per-file counts in the summary", async () => {
    const result = await runRemove({
      files: { "a.md": "A [@smith].\n", "b.md": "B [@smith] [@smith].\n" },
      key: "smith",
      citations: [citation(1, "smith")],
      library: [entry("smith")],
    });

    expect(result.output).toContain("Removed [@smith] from 2 file(s) (3 occurrence(s)).");
  });
});

interface RemoveFixture {
  files: Record<string, string>;
  refs?: string;
  key: string;
  citations: CitationEntry[];
  library: LibraryEntry[];
}

interface RemoveResult {
  output: string;
  filesAfter: Record<string, string>;
  refsAfter: string;
  before: Awaited<ReturnType<typeof import("../src/lib/doc-state.js").loadDocState>>;
  after: Awaited<ReturnType<typeof import("../src/lib/doc-state.js").loadDocState>>;
}

async function runRemove(fixture: RemoveFixture): Promise<RemoveResult> {
  const manifestPath = await writeProject(fixture.files, fixture.refs ?? "");
  const { initDocStateForManifest, loadDocState, saveDocState } = await import("../src/lib/doc-state.js");
  const { saveLibrary } = await import("../src/lib/library.js");
  const state = await initDocStateForManifest(manifestPath, "local", "vancouver" as CitationStyle);
  state.citations = fixture.citations;
  await saveDocState(state);
  await saveLibrary("local", fixture.library);
  const before = await loadDocState(state.docId);

  const logs: string[] = [];
  vi.spyOn(console, "log").mockImplementation((message = "") => { logs.push(String(message)); });

  const { registerRemoveCommand } = await import("../src/commands/remove.js");
  const program = new Command();
  program.exitOverride();
  registerRemoveCommand(program);
  await program.parseAsync(["node", "cite", "remove", "--manifest", manifestPath, "--key", fixture.key, "--yes"]);

  const filesAfter: Record<string, string> = {};
  for (const file of Object.keys(fixture.files)) filesAfter[file] = await readFile(join(env.workDir, file), "utf-8");
  return {
    output: logs.join("\n"),
    filesAfter,
    refsAfter: await readFile(join(env.workDir, "references.md"), "utf-8"),
    before,
    after: await loadDocState(state.docId),
  };
}

async function writeProject(files: Record<string, string>, refs: string): Promise<string> {
  for (const [relativePath, text] of Object.entries(files)) await writeFile(join(env.workDir, relativePath), text, "utf-8");
  await writeFile(join(env.workDir, "references.md"), refs, "utf-8");
  const manifestPath = join(env.workDir, "cite.manifest.yaml");
  await writeFile(manifestPath, `files:\n${Object.keys(files).map((file) => `  - ${file}`).join("\n")}\nbibliography: references.md\n`, "utf-8");
  return manifestPath;
}
