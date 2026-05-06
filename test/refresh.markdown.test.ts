// ABOUTME: Verifies refresh rebuilds markdown citation state from body markers.
// ABOUTME: Seeds temp citation state and markdown files without touching user data.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Command } from "commander";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setupCiteHome, type CiteHome } from "./helpers/cite-home.js";
import type { CitationEntry, CitationStyle, LibraryEntry } from "../src/types/index.js";

let env: CiteHome;

beforeEach(async () => { env = await setupCiteHome("cite-refresh-md-"); });
afterEach(async () => { await env.teardown(); });

describe("refresh markdown integration", () => {
  it("leaves matching state unchanged without warnings", async () => {
    const result = await runRefresh({
      markdown: "Body cites [@a] then [@b].\n",
      citations: [citation(1, "a"), citation(2, "b")],
      library: [entry("a"), entry("b")],
    });

    expect(result.output).not.toContain("Warning:");
    expect(result.after).toEqual(result.before);
  });

  it("warns and drops state keys missing from the file", async () => {
    const result = await runRefresh({
      markdown: "Body cites [@kept].\n",
      citations: [citation(1, "kept"), citation(2, "removed")],
      library: [entry("kept"), entry("removed")],
    });

    expect(result.output).toContain("Dropped citations:");
    expect(result.output).toContain("removed");
    expect(result.after.citations).toEqual([citation(1, "kept")]);
  });

  it("warns and adds file keys missing from state", async () => {
    const result = await runRefresh({
      markdown: "Body cites [@existing] then [@new].\n",
      citations: [citation(1, "existing")],
      library: [entry("existing"), entry("new")],
    });

    expect(result.output).toContain("Added citations:");
    expect(result.output).toContain("new");
    expect(result.after.citations).toEqual([
      citation(1, "existing"),
      citation(2, "new", "refresh"),
    ]);
  });

  it("renumbers citations by first appearance order", async () => {
    const result = await runRefresh({
      markdown: "Body cites [@b] then [@a].\n",
      citations: [citation(1, "a"), citation(2, "b")],
      library: [entry("a"), entry("b")],
    });

    expect(result.output).toContain("Renumbering plan:");
    expect(result.after.citations).toEqual([
      citation(1, "b"),
      citation(2, "a"),
    ]);
  });

  it("prints the diff without writing state in dry-run mode", async () => {
    const result = await runRefresh({
      markdown: "Body cites [@kept] then [@added].\n",
      citations: [citation(1, "kept"), citation(2, "removed")],
      library: [entry("kept"), entry("removed"), entry("added")],
      dryRun: true,
    });

    expect(result.output).toContain("Dropped citations:");
    expect(result.output).toContain("removed");
    expect(result.output).toContain("Added citations:");
    expect(result.output).toContain("added");
    expect(result.output).toContain("(dry-run mode");
    expect(result.after).toEqual(result.before);
  });

  it("is idempotent when run twice", async () => {
    const first = await runRefresh({
      markdown: "Body cites [@b] then [@a] then [@b].\n",
      citations: [citation(1, "a"), citation(2, "b")],
      library: [entry("a"), entry("b")],
    });
    const second = await rerunRefresh(first.markdownPath, first.state.docId);

    expect(second.output).not.toContain("Warning:");
    expect(second.after).toEqual(first.after);
  });
});

interface RefreshFixture {
  markdown: string;
  citations: CitationEntry[];
  library: LibraryEntry[];
  dryRun?: boolean;
}

interface RefreshResult {
  output: string;
  markdownPath: string;
  state: Awaited<ReturnType<typeof import("../src/lib/doc-state.js").initDocStateForMarkdown>>;
  before: Awaited<ReturnType<typeof import("../src/lib/doc-state.js").loadDocState>>;
  after: Awaited<ReturnType<typeof import("../src/lib/doc-state.js").loadDocState>>;
}

async function runRefresh(fixture: RefreshFixture): Promise<RefreshResult> {
  const markdownPath = join(env.workDir, "draft.md");
  await writeFile(markdownPath, fixture.markdown, "utf-8");

  const { initDocStateForMarkdown, loadDocState, saveDocState } = await import("../src/lib/doc-state.js");
  const { saveLibrary } = await import("../src/lib/library.js");

  const state = await initDocStateForMarkdown(markdownPath, "local", "vancouver" as CitationStyle);
  state.citations = fixture.citations;
  await saveDocState(state);
  await saveLibrary("local", fixture.library);
  const before = await loadDocState(state.docId);

  const output = await executeRefresh(markdownPath, fixture.dryRun);
  const after = await loadDocState(state.docId);

  return { output, markdownPath, state, before, after };
}

async function rerunRefresh(markdownPath: string, stateKey: string): Promise<Pick<RefreshResult, "output" | "after">> {
  const { loadDocState } = await import("../src/lib/doc-state.js");
  const output = await executeRefresh(markdownPath);
  const after = await loadDocState(stateKey);
  return { output, after };
}

async function executeRefresh(markdownPath: string, dryRun = false): Promise<string> {
  const { registerRefreshCommand } = await import("../src/commands/refresh.js");
  const logs: string[] = [];
  vi.spyOn(console, "log").mockImplementation((message = "") => {
    logs.push(String(message));
  });

  const program = new Command();
  program.exitOverride();
  registerRefreshCommand(program);
  const argv = ["node", "cite", "refresh", "--markdown", markdownPath, "--yes"];
  if (dryRun) argv.push("--dry-run");
  await program.parseAsync(argv);

  return logs.join("\n");
}

function citation(index: number, key: string, location = "test"): CitationEntry {
  return {
    index,
    key,
    location,
  };
}

function entry(key: string): LibraryEntry {
  return {
    key,
    addedAt: "2026-01-01T00:00:00.000Z",
    csl: {
      id: key,
      type: "article-journal",
      title: `Paper ${key}`,
      author: [{ given: "Alice", family: "Adams" }],
      issued: { "date-parts": [[2020]] },
    },
  };
}
