// ABOUTME: Verifies audit reporting for manifest-backed markdown projects.
// ABOUTME: Seeds multi-file citation state and libraries in isolated cite homes.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Command } from "commander";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setupCiteHome, type CiteHome } from "./helpers/cite-home.js";
import { citation, entry } from "./helpers/citation-fixtures.js";
import type { CitationEntry, CitationStyle, LibraryEntry } from "../src/types/index.js";

let env: CiteHome;

beforeEach(async () => { env = await setupCiteHome("cite-audit-manifest-"); });
afterEach(async () => { await env.teardown(); });

describe("audit manifest integration", () => {
  it("reports untracked markers with per-file paths", async () => {
    const output = await runAudit({
      files: { "intro.md": "Intro [@tracked] [@loose].\n", "body.md": "Body [@loose].\n" },
      citations: [citation(1, "tracked")],
      library: [entry("tracked"), entry("loose")],
    });

    expect(output).toContain("Untracked markers");
    expect(output).toContain("@loose");
    expect(output).toContain("intro.md");
    expect(output).toContain("body.md");
  });

  it("reports state keys missing from all manifest body files", async () => {
    const output = await runAudit({
      files: { "intro.md": "Intro without citations.\n" },
      citations: [citation(1, "missing")],
      library: [entry("missing")],
    });

    expect(output).toContain("Citations missing from doc body:");
    expect(output).toContain("missing");
  });

  it("reports no body-state issues when clean", async () => {
    const output = await runAudit({
      files: { "intro.md": "Intro [@tracked].\n" },
      citations: [citation(1, "tracked")],
      library: [entry("tracked")],
    });

    expect(output).toContain("Library matches: 1 ✓");
    expect(output).not.toContain("Untracked markers");
    expect(output).not.toContain("Citations missing from doc body");
  });

  it("does not print Google Docs fetch fallback messages for local manifests", async () => {
    const output = await runAudit({
      files: { "intro.md": "Intro [@tracked].\n" },
      citations: [citation(1, "tracked")],
      library: [entry("tracked")],
    });

    expect(output).not.toContain("Could not fetch document");
    expect(output).not.toContain("Using offline mode");
  });

  it("does not print Google Docs fetch fallback messages for offline local manifests", async () => {
    const output = await runAudit({
      files: { "intro.md": "Intro [@tracked].\n" },
      citations: [citation(1, "tracked")],
      library: [entry("tracked")],
      offline: true,
    });

    expect(output).not.toContain("Could not fetch document");
    expect(output).not.toContain("Using offline mode");
  });

  it("reports bibliography-only markers as untracked", async () => {
    const output = await runAudit({
      files: { "intro.md": "Intro.\n", "references.md": "Refs [@bibonly].\n" },
      manifestFiles: ["intro.md", "references.md"],
      bibliography: "references.md",
      citations: [],
      library: [entry("bibonly")],
    });

    // bib-only keys go into the dedicated bib report, NOT "Untracked markers
    // in body" — keeping them separate prevents stale state entries surviving
    // only in the generated bibliography from masking body/state mismatches.
    expect(output).toContain("Bibliography contains keys not present in body");
    expect(output).toContain("@bibonly");
    expect(output).toContain("references.md");
    expect(output).not.toContain("Untracked markers (in body but not in state)");
  });
});

interface AuditFixture {
  files: Record<string, string>;
  manifestFiles?: string[];
  bibliography?: string;
  citations: CitationEntry[];
  library: LibraryEntry[];
  offline?: boolean;
}

async function runAudit(fixture: AuditFixture): Promise<string> {
  const manifestPath = await writeProject(fixture);
  const { initDocStateForManifest, saveDocState } = await import("../src/lib/doc-state.js");
  const { saveLibrary } = await import("../src/lib/library.js");

  const state = await initDocStateForManifest(manifestPath, "local", "vancouver" as CitationStyle);
  state.citations = fixture.citations;
  await saveDocState(state);
  await saveLibrary("local", fixture.library);

  const logs: string[] = [];
  vi.spyOn(console, "log").mockImplementation((message = "") => { logs.push(String(message)); });

  const { registerAuditCommand } = await import("../src/commands/audit.js");
  const program = new Command();
  program.exitOverride();
  registerAuditCommand(program);
  const argv = ["node", "cite", "audit", "--manifest", manifestPath];
  if (fixture.offline) argv.push("--offline");
  await program.parseAsync(argv);
  return logs.join("\n");
}

async function writeProject(fixture: AuditFixture): Promise<string> {
  await mkdir(env.workDir, { recursive: true });
  for (const [relativePath, text] of Object.entries(fixture.files)) {
    await writeFile(join(env.workDir, relativePath), text, "utf-8");
  }
  const manifestFiles = fixture.manifestFiles ?? Object.keys(fixture.files).filter((name) => name !== (fixture.bibliography ?? "references.md"));
  const bibliography = fixture.bibliography ?? "references.md";
  if (!fixture.files[bibliography]) await writeFile(join(env.workDir, bibliography), "", "utf-8");
  const manifestPath = join(env.workDir, "cite.manifest.yaml");
  await writeFile(manifestPath, `files:\n${manifestFiles.map((file) => `  - ${file}`).join("\n")}\nbibliography: ${bibliography}\n`, "utf-8");
  return manifestPath;
}
