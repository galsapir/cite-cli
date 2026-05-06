// ABOUTME: Verifies refresh rebuilds state from manifest body citation order.
// ABOUTME: Exercises multi-file ordering, preservation, drops, and additions.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Command } from "commander";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setupCiteHome, type CiteHome } from "./helpers/cite-home.js";
import { citation, entry } from "./helpers/citation-fixtures.js";
import type { CitationEntry, CitationStyle, LibraryEntry } from "../src/types/index.js";

let env: CiteHome;

beforeEach(async () => { env = await setupCiteHome("cite-refresh-manifest-"); });
afterEach(async () => { await env.teardown(); });

describe("refresh manifest integration", () => {
  it("uses first appearance order across manifest body files", async () => {
    const result = await runRefresh({
      files: { "a.md": "A [@b].\n", "b.md": "B [@a].\n" },
      citations: [citation(1, "a"), citation(2, "b")],
      library: [entry("a"), entry("b")],
    });

    expect(result.after?.citations).toEqual([citation(1, "b"), citation(2, "a")]);
  });

  it("preserves existing citation metadata for present keys", async () => {
    const result = await runRefresh({
      files: { "a.md": "A [@kept].\n" },
      citations: [{ ...citation(1, "kept", "original"), namedRangeIds: ["0:2+7"] }],
      library: [entry("kept")],
    });

    expect(result.after?.citations).toEqual([{ ...citation(1, "kept", "original"), namedRangeIds: ["0:2+7"] }]);
  });

  it("drops stale state entries missing from body", async () => {
    const result = await runRefresh({
      files: { "a.md": "A [@kept].\n" },
      citations: [citation(1, "kept"), citation(2, "gone")],
      library: [entry("kept"), entry("gone")],
    });

    expect(result.output).toContain("Dropped citations:");
    expect(result.after?.citations).toEqual([citation(1, "kept")]);
  });

  it("adds new body keys to state", async () => {
    const result = await runRefresh({
      files: { "a.md": "A [@existing] [@added].\n" },
      citations: [citation(1, "existing")],
      library: [entry("existing"), entry("added")],
    });

    expect(result.output).toContain("Added citations:");
    expect(result.after?.citations).toEqual([citation(1, "existing"), citation(2, "added", "manifest-rebuild")]);
  });
});

interface RefreshFixture {
  files: Record<string, string>;
  citations: CitationEntry[];
  library: LibraryEntry[];
}

async function runRefresh(fixture: RefreshFixture): Promise<{ output: string; after: Awaited<ReturnType<typeof import("../src/lib/doc-state.js").loadDocState>> }> {
  const manifestPath = await writeProject(fixture.files);
  const { initDocStateForManifest, loadDocState, saveDocState } = await import("../src/lib/doc-state.js");
  const { saveLibrary } = await import("../src/lib/library.js");
  const state = await initDocStateForManifest(manifestPath, "local", "vancouver" as CitationStyle);
  state.citations = fixture.citations;
  await saveDocState(state);
  await saveLibrary("local", fixture.library);

  const logs: string[] = [];
  vi.spyOn(console, "log").mockImplementation((message = "") => { logs.push(String(message)); });

  const { registerRefreshCommand } = await import("../src/commands/refresh.js");
  const program = new Command();
  program.exitOverride();
  registerRefreshCommand(program);
  await program.parseAsync(["node", "cite", "refresh", "--manifest", manifestPath, "--yes"]);
  return { output: logs.join("\n"), after: await loadDocState(state.docId) };
}

async function writeProject(files: Record<string, string>): Promise<string> {
  for (const [relativePath, text] of Object.entries(files)) await writeFile(join(env.workDir, relativePath), text, "utf-8");
  await writeFile(join(env.workDir, "references.md"), "", "utf-8");
  const manifestPath = join(env.workDir, "cite.manifest.yaml");
  await writeFile(manifestPath, `files:\n${Object.keys(files).map((file) => `  - ${file}`).join("\n")}\nbibliography: references.md\n`, "utf-8");
  return manifestPath;
}
