// ABOUTME: Verifies cite use support for manifest-backed markdown projects.
// ABOUTME: Covers setting, clearing, mutex errors, and display-mode output.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Command } from "commander";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { setupCiteHome, type CiteHome } from "./helpers/cite-home.js";

let env: CiteHome;

beforeEach(async () => {
  env = await setupCiteHome("cite-use-manifest-");
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
  await env.teardown();
});

describe("use --manifest", () => {
  it("sets defaults.manifest and clears doc and markdown defaults", async () => {
    const manifestPath = await writeInitializedManifest();
    const { updateConfig } = await import("../src/lib/config.js");
    await updateConfig({ defaults: { doc: "doc-1", markdown: join(env.workDir, "draft.md") } });

    await runUse(["--manifest", manifestPath]);

    const config = await readConfig();
    expect(config).toContain(`manifest: ${resolve(manifestPath)}`);
    expect(config).not.toContain("doc:");
    expect(config).not.toContain("markdown:");
  });

  it("errors when the manifest has not been initialized", async () => {
    const manifestPath = join(env.workDir, "cite.manifest.yaml");
    await writeFile(manifestPath, "files: []\nbibliography: references.md\n", "utf-8");

    const result = await runUseExpectExit(["--manifest", manifestPath]);

    expect(result.errors.join("\n")).toContain(`Manifest ${manifestPath} not initialized. Run 'cite init --manifest ${manifestPath}' first.`);
  });

  it("errors when doc and manifest are both passed", async () => {
    const result = await runUseExpectExit(["--doc", "doc-1", "--manifest", join(env.workDir, "cite.manifest.yaml")]);
    expect(result.errors.join("\n")).toContain("Pass at most one of --doc, --markdown, --manifest.");
  });

  it("clears defaults.manifest", async () => {
    const manifestPath = await writeInitializedManifest();
    await runUse(["--manifest", manifestPath]);

    await runUse(["--clear"]);

    const config = await readConfig();
    expect(config).not.toContain("manifest:");
  });

  it("shows active manifest details", async () => {
    const manifestPath = await writeInitializedManifest();
    await runUse(["--manifest", manifestPath]);
    const logs = captureLogs();

    await runUse([]);

    const output = logs.join("\n");
    expect(output).toContain("Manifest:");
    expect(output).toContain(resolve(manifestPath));
    expect(output).toContain("Library:    library-1");
    expect(output).toContain("Style:      vancouver");
    expect(output).toContain("Citations:  0");
  });
});

async function writeInitializedManifest(): Promise<string> {
  const manifestPath = join(env.workDir, "cite.manifest.yaml");
  await writeFile(manifestPath, "files: []\nbibliography: references.md\n", "utf-8");
  const { initDocStateForManifest } = await import("../src/lib/doc-state.js");
  await initDocStateForManifest(manifestPath, "library-1", "vancouver");
  return manifestPath;
}

async function runUse(args: string[]): Promise<void> {
  const { registerUseCommand } = await import("../src/commands/use.js");
  const program = new Command();
  program.exitOverride();
  registerUseCommand(program);
  await program.parseAsync(["node", "cite", "use", ...args]);
}

async function runUseExpectExit(args: string[]): Promise<{ errors: string[] }> {
  const errors: string[] = [];
  vi.mocked(console.error).mockImplementation((message = "") => {
    errors.push(String(message));
  });
  vi.spyOn(process, "exit").mockImplementation((() => {
    throw new Error("process.exit");
  }) as never);
  await expect(runUse(args)).rejects.toThrow("process.exit");
  return { errors };
}

async function readConfig(): Promise<string> {
  return readFile(join(process.env.HOME!, ".cite", "config.yaml"), "utf-8");
}

function captureLogs(): string[] {
  const logs: string[] = [];
  vi.mocked(console.log).mockImplementation((message = "") => {
    logs.push(String(message));
  });
  return logs;
}
