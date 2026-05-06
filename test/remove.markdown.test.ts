// ABOUTME: Verifies remove rewrites markdown citations and keeps citation state tight.
// ABOUTME: Seeds temp markdown files and state without touching user data.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Command } from "commander";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setupCiteHome, type CiteHome } from "./helpers/cite-home.js";
import { citation, entry } from "./helpers/citation-fixtures.js";
import type { CitationEntry, CitationStyle, LibraryEntry } from "../src/types/index.js";

let env: CiteHome;

beforeEach(async () => { env = await setupCiteHome("cite-remove-md-"); });
afterEach(async () => { await env.teardown(); });

describe("remove markdown integration", () => {
  it("deletes a single-key bracket and cleans spacing", async () => {
    const result = await runRemove({
      markdown: "Hello [@smith] world.\n",
      key: "smith",
      citations: [citation(1, "smith")],
      library: [entry("smith")],
    });

    expect(result.markdownAfter).toBe("Hello world.\n");
    expect(result.after?.citations).toEqual([]);
  });

  it("removes a composite middle segment", async () => {
    const result = await runRemove({
      markdown: "Body [@a; @smith; @b].\n",
      key: "smith",
      citations: [citation(1, "a"), citation(2, "smith"), citation(3, "b")],
      library: [entry("a"), entry("smith"), entry("b")],
    });

    expect(result.markdownAfter).toBe("Body [@a; @b].\n");
    expect(result.after?.citations).toEqual([citation(1, "a"), citation(2, "b")]);
  });

  it("removes a composite start segment", async () => {
    const result = await runRemove({
      markdown: "Body [@smith; @b].\n",
      key: "smith",
      citations: [citation(1, "smith"), citation(2, "b")],
      library: [entry("smith"), entry("b")],
    });

    expect(result.markdownAfter).toBe("Body [@b].\n");
    expect(result.after?.citations).toEqual([citation(1, "b")]);
  });

  it("removes a composite end segment", async () => {
    const result = await runRemove({
      markdown: "Body [@a; @smith].\n",
      key: "smith",
      citations: [citation(1, "a"), citation(2, "smith")],
      library: [entry("a"), entry("smith")],
    });

    expect(result.markdownAfter).toBe("Body [@a].\n");
    expect(result.after?.citations).toEqual([citation(1, "a")]);
  });

  it("deletes an author-suppressed single-key bracket", async () => {
    const result = await runRemove({
      markdown: "Hello [-@smith] world.\n",
      key: "smith",
      citations: [citation(1, "smith")],
      library: [entry("smith")],
    });

    expect(result.markdownAfter).toBe("Hello world.\n");
    expect(result.after?.citations).toEqual([]);
  });

  it("removes an author-suppressed composite segment", async () => {
    const result = await runRemove({
      markdown: "Body [@a; -@smith; @b].\n",
      key: "smith",
      citations: [citation(1, "a"), citation(2, "smith"), citation(3, "b")],
      library: [entry("a"), entry("smith"), entry("b")],
    });

    expect(result.markdownAfter).toBe("Body [@a; @b].\n");
    expect(result.after?.citations).toEqual([citation(1, "a"), citation(2, "b")]);
  });

  it("deletes a bracket with a locator", async () => {
    const result = await runRemove({
      markdown: "Hello [@smith, p. 12] world.\n",
      key: "smith",
      citations: [citation(1, "smith")],
      library: [entry("smith")],
    });

    expect(result.markdownAfter).toBe("Hello world.\n");
    expect(result.after?.citations).toEqual([]);
  });

  it("removes multiple body occurrences in one pass", async () => {
    const result = await runRemove({
      markdown: "Foo [@smith] bar [@smith; @b] baz.\n",
      key: "smith",
      citations: [citation(1, "smith"), citation(2, "b")],
      library: [entry("smith"), entry("b")],
    });

    expect(result.markdownAfter).toBe("Foo bar [@b] baz.\n");
    expect(result.after?.citations).toEqual([citation(1, "b")]);
  });

  it("cleans state when the key is absent from body", async () => {
    const result = await runRemove({
      markdown: "Body [@a].\n",
      key: "smith",
      citations: [citation(1, "a"), citation(2, "smith")],
      library: [entry("a"), entry("smith")],
    });

    expect(result.markdownAfter).toBe("Body [@a].\n");
    expect(result.after?.citations).toEqual([citation(1, "a")]);
    expect(result.output).toContain("State cleanup: yes");
  });

  it("returns cleanly when the key is absent from body and state", async () => {
    const result = await runRemove({
      markdown: "Body [@a].\n",
      key: "smith",
      citations: [citation(1, "a")],
      library: [entry("a")],
    });

    expect(result.markdownAfter).toBe("Body [@a].\n");
    expect(result.after).toEqual(result.before);
    expect(result.output).toContain("Key 'smith' not found in document or state.");
  });

  it("prints a dry-run preview without changing file or state", async () => {
    const result = await runRemove({
      markdown: "Hello [@smith] world.\n",
      key: "smith",
      citations: [citation(1, "smith")],
      library: [entry("smith")],
      dryRun: true,
    });

    expect(result.markdownAfter).toBe("Hello [@smith] world.\n");
    expect(result.after).toEqual(result.before);
    expect(result.output).toContain("Affected citation brackets: 1");
    expect(result.output).toContain("(dry-run mode");
  });

  it("renumbers state by first body appearance after removal", async () => {
    const result = await runRemove({
      markdown: "First [@a]. Remove [@smith]. Last [@b].\n",
      key: "smith",
      citations: [citation(1, "a"), citation(2, "smith"), citation(3, "b")],
      library: [entry("a"), entry("smith"), entry("b")],
    });

    expect(result.markdownAfter).toBe("First [@a]. Remove. Last [@b].\n");
    expect(result.after?.citations).toEqual([citation(1, "a"), citation(2, "b")]);
  });

  it("leaves markdown links untouched while removing citation brackets", async () => {
    const result = await runRemove({
      markdown: "Link [@torvalds](https://github.com/torvalds) cite [@torvalds].\n",
      key: "torvalds",
      citations: [citation(1, "torvalds")],
      library: [entry("torvalds")],
    });

    expect(result.markdownAfter).toBe("Link [@torvalds](https://github.com/torvalds) cite.\n");
    expect(result.after?.citations).toEqual([]);
  });

  it("preserves segments where the target appears only as literal suffix text", async () => {
    // Pandoc grammar: only the FIRST @key of a segment is the cite-key.
    // In `[@a; @smith for @b context]`, @b is literal suffix text within
    // the @smith segment — removing smith should drop only that segment,
    // leaving the @a cite intact.
    const result = await runRemove({
      markdown: "See [@a; @smith for @b context] earlier.\n",
      key: "smith",
      citations: [citation(1, "a"), citation(2, "smith")],
      library: [entry("a"), entry("smith")],
    });

    expect(result.markdownAfter).toBe("See [@a] earlier.\n");
    expect(result.after?.citations).toEqual([citation(1, "a", "test")]);
  });

  it("does not touch a bracket where the target only appears as literal suffix text", async () => {
    // `[@a; @b for @smith reason]` — smith is literal in @b's suffix.
    // Removing smith must NOT drop the @b segment; the bracket is left alone.
    const result = await runRemove({
      markdown: "See [@a; @b for @smith reason] earlier.\n",
      key: "smith",
      citations: [citation(1, "a"), citation(2, "b"), citation(3, "smith")],
      library: [entry("a"), entry("b"), entry("smith")],
    });

    // Body unchanged — smith is suffix text, not a cite-key in any segment.
    expect(result.markdownAfter).toBe("See [@a; @b for @smith reason] earlier.\n");
    // State entry for smith dropped; remaining cites renumber.
    expect(result.after?.citations).toEqual([citation(1, "a", "test"), citation(2, "b", "test")]);
  });
});

interface RemoveFixture {
  markdown: string;
  key: string;
  citations: CitationEntry[];
  library: LibraryEntry[];
  dryRun?: boolean;
}

interface RemoveResult {
  output: string;
  markdownAfter: string;
  before: Awaited<ReturnType<typeof import("../src/lib/doc-state.js").loadDocState>>;
  after: Awaited<ReturnType<typeof import("../src/lib/doc-state.js").loadDocState>>;
}

async function runRemove(fixture: RemoveFixture): Promise<RemoveResult> {
  const markdownPath = join(env.workDir, "draft.md");
  await writeFile(markdownPath, fixture.markdown, "utf-8");

  const { initDocStateForMarkdown, loadDocState, saveDocState } = await import("../src/lib/doc-state.js");
  const { saveLibrary } = await import("../src/lib/library.js");

  const state = await initDocStateForMarkdown(markdownPath, "local", "vancouver" as CitationStyle);
  state.citations = fixture.citations;
  await saveDocState(state);
  await saveLibrary("local", fixture.library);
  const before = await loadDocState(state.docId);

  const output = await executeRemove(markdownPath, fixture.key, fixture.dryRun);
  const after = await loadDocState(state.docId);
  const markdownAfter = await readFile(markdownPath, "utf-8");

  return { output, markdownAfter, before, after };
}

async function executeRemove(markdownPath: string, key: string, dryRun = false): Promise<string> {
  const { registerRemoveCommand } = await import("../src/commands/remove.js");
  const logs: string[] = [];
  vi.spyOn(console, "log").mockImplementation((message = "") => {
    logs.push(String(message));
  });

  const program = new Command();
  program.exitOverride();
  registerRemoveCommand(program);
  const argv = ["node", "cite", "remove", "--markdown", markdownPath, "--key", key, "--yes"];
  if (dryRun) argv.push("--dry-run");
  await program.parseAsync(argv);

  return logs.join("\n");
}

