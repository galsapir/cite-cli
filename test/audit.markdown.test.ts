// ABOUTME: Verifies audit reporting for markdown documents through the CLI command.
// ABOUTME: Seeds temp citation state and libraries without touching the user's cite home.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Command } from "commander";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setupCiteHome, type CiteHome } from "./helpers/cite-home.js";
import { citation, entry } from "./helpers/citation-fixtures.js";
import type { CitationEntry, CitationStyle, LibraryEntry } from "../src/types/index.js";

let env: CiteHome;

beforeEach(async () => { env = await setupCiteHome("cite-audit-md-"); });
afterEach(async () => { await env.teardown(); });

describe("audit markdown integration", () => {
  it("reports no warnings when state, body, and library match", async () => {
    const output = await runAudit({
      markdown: "Body cites [@battelino2019].\n",
      citations: [citation(1, "battelino2019")],
      library: [entry("battelino2019")],
    });

    expect(output).toContain("Library matches: 1 ✓");
    expect(output).not.toContain("Missing from library");
    expect(output).not.toContain("Numbering gaps");
    expect(output).not.toContain("Orphaned library entries");
    expect(output).not.toContain("Untracked markers in doc");
    expect(output).not.toContain("Citations missing from doc body");
  });

  it("reports a state key missing from the markdown body", async () => {
    const output = await runAudit({
      markdown: "Body has no citations.\n",
      citations: [citation(1, "battelino2019")],
      library: [entry("battelino2019")],
    });

    expect(output).toContain("Citations missing from doc body:");
    expect(output).toContain("battelino2019");
  });

  it("reports a markdown body key missing from state", async () => {
    const output = await runAudit({
      markdown: "Body cites [@battelino2019] and [@khasentino2025].\n",
      citations: [citation(1, "battelino2019")],
      library: [entry("battelino2019"), entry("khasentino2025")],
    });

    expect(output).toContain("Untracked markers in doc:");
    expect(output).toContain("@khasentino2025");
  });

  it("reports orphaned library entries not cited in state", async () => {
    const output = await runAudit({
      markdown: "Body cites [@battelino2019].\n",
      citations: [citation(1, "battelino2019")],
      library: [entry("battelino2019"), entry("unused2020")],
    });

    expect(output).toContain("Orphaned library entries (not cited): 1");
    expect(output).toContain("unused2020");
  });

  it("preserves the markdown file path as the document title in --offline mode", async () => {
    const output = await runAudit({
      markdown: "Body cites [@battelino2019].\n",
      citations: [citation(1, "battelino2019")],
      library: [entry("battelino2019")],
      offline: true,
    });

    expect(output).toMatch(/Document: "markdown:.*draft\.md"/);
    expect(output).not.toContain('"(offline mode)"');
    expect(output).not.toContain("Untracked markers in doc");
    expect(output).not.toContain("Citations missing from doc body");
  });

  it("does not print Google Docs fetch fallback messages for local markdown", async () => {
    const output = await runAudit({
      markdown: "Body cites [@battelino2019].\n",
      citations: [citation(1, "battelino2019")],
      library: [entry("battelino2019")],
    });

    expect(output).not.toContain("Could not fetch document");
    expect(output).not.toContain("Using offline mode");
  });

  it("does not print Google Docs fetch fallback messages for offline local markdown", async () => {
    const output = await runAudit({
      markdown: "Body cites [@battelino2019].\n",
      citations: [citation(1, "battelino2019")],
      library: [entry("battelino2019")],
      offline: true,
    });

    expect(output).not.toContain("Could not fetch document");
    expect(output).not.toContain("Using offline mode");
  });
});

interface AuditFixture {
  markdown: string;
  citations: CitationEntry[];
  library: LibraryEntry[];
  offline?: boolean;
}

async function runAudit(fixture: AuditFixture): Promise<string> {
  const markdownPath = join(env.workDir, "draft.md");
  await writeFile(markdownPath, fixture.markdown, "utf-8");

  const { initDocStateForMarkdown, saveDocState } = await import("../src/lib/doc-state.js");
  const { saveLibrary } = await import("../src/lib/library.js");
  const { registerAuditCommand } = await import("../src/commands/audit.js");

  const state = await initDocStateForMarkdown(markdownPath, "local", "vancouver" as CitationStyle);
  state.citations = fixture.citations;
  await saveDocState(state);
  await saveLibrary("local", fixture.library);

  const logs: string[] = [];
  vi.spyOn(console, "log").mockImplementation((message = "") => {
    logs.push(String(message));
  });

  const program = new Command();
  program.exitOverride();
  registerAuditCommand(program);
  const argv = ["node", "cite", "audit", "--markdown", markdownPath];
  if (fixture.offline) argv.push("--offline");
  await program.parseAsync(argv);

  return logs.join("\n");
}
