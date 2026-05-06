// ABOUTME: Verifies the markdown bibliography upsert flow used by 'cite bib --markdown'.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Command } from "commander";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MarkdownDocumentSource } from "../src/lib/markdown-source.js";
import { formatBibEntry } from "../src/lib/formatter.js";
import { setupCiteHome, type CiteHome } from "./helpers/cite-home.js";
import type { CslJson } from "../src/types/index.js";

let workDir: string;
let env: CiteHome;
beforeEach(async () => {
  env = await setupCiteHome("cite-bib-md-home-");
  workDir = await mkdtemp(join(tmpdir(), "cite-bib-md-"));
});
afterEach(async () => {
  await env.teardown();
  await rm(workDir, { recursive: true, force: true });
});

describe("bib markdown integration", () => {
  it("appends a vancouver-formatted ## References section the first time", async () => {
    const path = join(workDir, "draft.md");
    await writeFile(path, "# Title\n\nBody mentions [@one] and [@two].\n", "utf-8");
    const source = new MarkdownDocumentSource(path);
    const csl1: CslJson = {
      id: "one",
      type: "article-journal",
      title: "First paper",
      author: [{ given: "Alice", family: "Adams" }],
      issued: { "date-parts": [[2020]] },
      "container-title": "Journal A",
    };
    const csl2: CslJson = {
      id: "two",
      type: "article-journal",
      title: "Second paper",
      author: [{ given: "Bob", family: "Brown" }],
      issued: { "date-parts": [[2022]] },
      "container-title": "Journal B",
    };
    const bibText = "\n\n" + [
      formatBibEntry(1, csl1, "vancouver"),
      formatBibEntry(2, csl2, "vancouver"),
    ].join("\n") + "\n";

    await source.writeBibliography(bibText, {});
    const after = await readFile(path, "utf-8");
    expect(after).toContain("## References");
    expect(after).toMatch(/1\. Adams A\. First paper\. Journal A\. 2020\./);
    expect(after).toMatch(/2\. Brown B\. Second paper\. Journal B\. 2022\./);
  });

  it("replaces an existing ## References section without disturbing later sections", async () => {
    const path = join(workDir, "draft.md");
    await writeFile(
      path,
      "# Paper\n\nBody.\n\n## References\n\n1. Old reference.\n2. Older still.\n\n## Appendix\n\nMore text.\n",
      "utf-8",
    );
    const source = new MarkdownDocumentSource(path);
    await source.writeBibliography("\n\n1. Brand new ref.\n", {});
    const after = await readFile(path, "utf-8");
    expect(after).toContain("1. Brand new ref.");
    expect(after).not.toContain("Old reference");
    expect(after).not.toContain("Older still");
    expect(after).toContain("## Appendix");
  });

  it("warns and leaves an existing bibliography untouched when no citations remain", async () => {
    const path = join(workDir, "draft.md");
    const before = "# Paper\n\nBody.\n\n## References\n\n1. Old entry.\n";
    await writeFile(path, before, "utf-8");
    const { initDocStateForMarkdown } = await import("../src/lib/doc-state.js");
    await initDocStateForMarkdown(path, "local", "vancouver");

    const output = await runBibWithOutput(["--markdown", path, "-y"]);

    expect(output).toContain(`Warning: The bibliography section in ${path} still contains entries from a previous run.`);
    expect(output).toContain("No citations remain in the manuscript; the bibliography file was NOT modified automatically.");
    await expect(readFile(path, "utf-8")).resolves.toBe(before);
  });
});

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
