// ABOUTME: Verifies audit reporting for markdown documents through the CLI command.
// ABOUTME: Seeds temp citation state and libraries without touching the user's cite home.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Command } from "commander";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CitationEntry, CitationStyle, LibraryEntry } from "../src/types/index.js";

let workDir: string;
let originalHome: string | undefined;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "cite-audit-md-"));
  originalHome = process.env.HOME;
  process.env.HOME = join(workDir, "home");
  await mkdir(join(process.env.HOME, ".cite", "docs"), { recursive: true });
  await mkdir(join(process.env.HOME, ".cite", "libraries"), { recursive: true });
  vi.resetModules();
});

afterEach(async () => {
  if (originalHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = originalHome;
  }
  vi.restoreAllMocks();
  await rm(workDir, { recursive: true, force: true });
});

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
});

interface AuditFixture {
  markdown: string;
  citations: CitationEntry[];
  library: LibraryEntry[];
}

async function runAudit(fixture: AuditFixture): Promise<string> {
  const markdownPath = join(workDir, "draft.md");
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
  await program.parseAsync(["node", "cite", "audit", "--markdown", markdownPath]);

  return logs.join("\n");
}

function citation(index: number, key: string): CitationEntry {
  return {
    index,
    key,
    location: "test",
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
