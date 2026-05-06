// ABOUTME: Verifies insert writes pandoc citations into markdown anchors.
// ABOUTME: Seeds temp markdown files and citation state without touching user data.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Command } from "commander";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setupCiteHome, type CiteHome } from "./helpers/cite-home.js";
import { citation, entry } from "./helpers/citation-fixtures.js";
import type { CitationEntry, CitationStyle, LibraryEntry } from "../src/types/index.js";

let env: CiteHome;

beforeEach(async () => { env = await setupCiteHome("cite-insert-md-"); });
afterEach(async () => { await env.teardown(); });

describe("insert markdown integration", () => {
  it("inserts a single key after literal text", async () => {
    const result = await runInsert({
      markdown: "Hello world.\n",
      args: ["--after", "world.", "--key", "smith"],
      library: [entry("smith")],
    });

    expect(result.markdownAfter).toBe("Hello world.[@smith]\n");
    expect(result.after?.citations).toEqual([citation(1, "smith", "insert:--after=world.")]);
  });

  it("targets the requested literal occurrence", async () => {
    const result = await runInsert({
      markdown: "One hit. Two hit.\n",
      args: ["--after", "hit.", "--occurrence", "2", "--key", "smith"],
      library: [entry("smith")],
    });

    expect(result.markdownAfter).toBe("One hit. Two hit.[@smith]\n");
  });

  it("errors when after text is not found", async () => {
    const result = await runInsertExpectExit({
      markdown: "Hello world.\n",
      args: ["--after", "missing", "--key", "smith"],
      library: [entry("smith")],
    });

    expect(result.errorOutput).toContain("missing");
    expect(result.markdownAfter).toBe("Hello world.\n");
  });

  it("inserts at the end of a paragraph by default", async () => {
    const result = await runInsert({
      markdown: "First paragraph.\n\nSecond paragraph.\n",
      args: ["--paragraph", "1", "--key", "smith"],
      library: [entry("smith")],
    });

    expect(result.markdownAfter).toBe("First paragraph.[@smith]\n\nSecond paragraph.\n");
  });

  it("inserts at the start of a paragraph", async () => {
    const result = await runInsert({
      markdown: "First paragraph.\n\nSecond paragraph.\n",
      args: ["--paragraph", "1", "--position", "start", "--key", "smith"],
      library: [entry("smith")],
    });

    expect(result.markdownAfter).toBe("[@smith]First paragraph.\n\nSecond paragraph.\n");
  });

  it("errors when paragraph is out of range", async () => {
    const result = await runInsertExpectExit({
      markdown: "Only paragraph.\n",
      args: ["--paragraph", "2", "--key", "smith"],
      library: [entry("smith")],
    });

    expect(result.errorOutput).toContain("Paragraph 2");
    expect(result.markdownAfter).toBe("Only paragraph.\n");
  });

  it("inserts multiple keys in one pandoc marker", async () => {
    const result = await runInsert({
      markdown: "Hello world.\n",
      args: ["--after", "world.", "--keys", "a,b"],
      library: [entry("a"), entry("b")],
    });

    expect(result.markdownAfter).toBe("Hello world.[@a; @b]\n");
    expect(result.after?.citations).toEqual([
      citation(1, "a", "insert:--after=world."),
      citation(2, "b", "insert:--after=world."),
    ]);
  });

  it("errors with unknown keys listed", async () => {
    const result = await runInsertExpectExit({
      markdown: "Hello world.\n",
      args: ["--after", "world.", "--keys", "smith,missing"],
      library: [entry("smith")],
    });

    expect(result.errorOutput).toContain("missing");
    expect(result.markdownAfter).toBe("Hello world.\n");
  });

  it("previews without writing during dry run", async () => {
    const result = await runInsert({
      markdown: "Hello world.\n",
      args: ["--after", "world.", "--key", "smith", "--dry-run"],
      library: [entry("smith")],
    });

    expect(result.output).toContain("[@smith]");
    expect(result.output).toContain("dry-run mode");
    expect(result.markdownAfter).toBe("Hello world.\n");
    expect(result.after).toEqual(result.before);
  });

  it("renumbers state by first body appearance after insert", async () => {
    const result = await runInsert({
      markdown: "Start [@a] end.\n",
      args: ["--after", "end.", "--key", "b"],
      citations: [citation(1, "a")],
      library: [entry("a"), entry("b")],
    });

    expect(result.markdownAfter).toBe("Start [@a] end.[@b]\n");
    expect(result.after?.citations).toEqual([
      citation(1, "a"),
      citation(2, "b", "insert:--after=end."),
    ]);
  });

  it("detects concurrent edits between locating and writing", async () => {
    const markdownPath = join(env.workDir, "draft.md");
    await writeFile(markdownPath, "Hello world.\n", "utf-8");
    const { MarkdownChangedDuringRunError, MarkdownDocumentSource } = await import("../src/lib/markdown-source.js");
    const source = new MarkdownDocumentSource(markdownPath);

    const offset = await source.locateInsertionPoint({ type: "after", value: "world." });
    await new Promise((resolve) => setTimeout(resolve, 5));
    await writeFile(markdownPath, "Manual edit.\n", "utf-8");

    await expect(source.writeInsertion(offset, "[@smith]")).rejects.toBeInstanceOf(MarkdownChangedDuringRunError);
    expect(await readFile(markdownPath, "utf-8")).toBe("Manual edit.\n");
  });

  it("does not add spacing around inserted markers", async () => {
    const result = await runInsert({
      markdown: "A sentence.\n",
      args: ["--after", "sentence.", "--key", "smith"],
      library: [entry("smith")],
    });

    expect(result.markdownAfter).toBe("A sentence.[@smith]\n");
  });

  it("rejects after and paragraph together", async () => {
    const result = await runInsertExpectExit({
      markdown: "Hello world.\n",
      args: ["--after", "world.", "--paragraph", "1", "--key", "smith"],
      library: [entry("smith")],
    });

    expect(result.errorOutput).toContain("--after");
    expect(result.errorOutput).toContain("--paragraph");
    expect(result.markdownAfter).toBe("Hello world.\n");
  });
});

interface InsertFixture {
  markdown: string;
  args: string[];
  citations?: CitationEntry[];
  library: LibraryEntry[];
}

interface InsertResult {
  output: string;
  errorOutput: string;
  markdownAfter: string;
  before: Awaited<ReturnType<typeof import("../src/lib/doc-state.js").loadDocState>>;
  after: Awaited<ReturnType<typeof import("../src/lib/doc-state.js").loadDocState>>;
}

async function runInsert(fixture: InsertFixture): Promise<InsertResult> {
  return runInsertFixture(fixture, false);
}

async function runInsertExpectExit(fixture: InsertFixture): Promise<InsertResult> {
  return runInsertFixture(fixture, true);
}

async function runInsertFixture(fixture: InsertFixture, expectExit: boolean): Promise<InsertResult> {
  const markdownPath = join(env.workDir, "draft.md");
  await writeFile(markdownPath, fixture.markdown, "utf-8");

  const { initDocStateForMarkdown, loadDocState, saveDocState } = await import("../src/lib/doc-state.js");
  const { saveLibrary } = await import("../src/lib/library.js");

  const state = await initDocStateForMarkdown(markdownPath, "local", "vancouver" as CitationStyle);
  state.citations = fixture.citations ?? [];
  await saveDocState(state);
  await saveLibrary("local", fixture.library);
  const before = await loadDocState(state.docId);

  const { output, errorOutput } = await executeInsert(markdownPath, fixture.args, expectExit);
  const after = await loadDocState(state.docId);
  const markdownAfter = await readFile(markdownPath, "utf-8");

  return { output, errorOutput, markdownAfter, before, after };
}

async function executeInsert(markdownPath: string, args: string[], expectExit: boolean): Promise<{ output: string; errorOutput: string }> {
  const { registerInsertCommand } = await import("../src/commands/insert.js");
  const logs: string[] = [];
  const errors: string[] = [];
  vi.spyOn(console, "log").mockImplementation((message = "") => {
    logs.push(String(message));
  });
  vi.spyOn(console, "error").mockImplementation((message = "") => {
    errors.push(String(message));
  });
  const exit = vi.spyOn(process, "exit").mockImplementation((() => {
    throw new Error("process.exit");
  }) as never);

  const program = new Command();
  program.exitOverride();
  registerInsertCommand(program);
  const argv = ["node", "cite", "insert", "--markdown", markdownPath, "--yes", ...args];
  if (expectExit) {
    await expect(program.parseAsync(argv)).rejects.toThrow("process.exit");
  } else {
    await program.parseAsync(argv);
  }
  exit.mockRestore();

  return { output: logs.join("\n"), errorOutput: errors.join("\n") };
}
