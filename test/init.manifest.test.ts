// ABOUTME: Verifies init command support for manifest-backed markdown projects.
// ABOUTME: Covers auto-created manifests, state records, and flag mutex errors.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Command } from "commander";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { setupCiteHome, type CiteHome } from "./helpers/cite-home.js";

let env: CiteHome;

beforeEach(async () => {
  env = await setupCiteHome("cite-init-manifest-");
});

afterEach(async () => {
  await env.teardown();
});

describe("init --manifest", () => {
  it("auto-creates a missing manifest and creates state", async () => {
    const manifestPath = join(env.workDir, "cite.manifest.yaml");
    await runInit(["--manifest", manifestPath]);

    await expect(readFile(manifestPath, "utf-8")).resolves.toBe("files: []\nbibliography: references.md\n");
    const { loadDocState, stateKeyForSource } = await import("../src/lib/doc-state.js");
    const stateKey = stateKeyForSource({ type: "markdown-manifest", manifestPath });
    const state = await loadDocState(stateKey);
    expect(state?.source).toEqual({ type: "markdown-manifest", manifestPath: resolve(manifestPath) });
  });

  it("leaves an existing manifest untouched and creates state", async () => {
    const manifestPath = join(env.workDir, "cite.manifest.yaml");
    const manifestText = "files: []\nbibliography: refs.md\n";
    await writeFile(manifestPath, manifestText, "utf-8");

    await runInit(["--manifest", manifestPath]);

    await expect(readFile(manifestPath, "utf-8")).resolves.toBe(manifestText);
    const { loadDocState, stateKeyForSource } = await import("../src/lib/doc-state.js");
    const state = await loadDocState(stateKeyForSource({ type: "markdown-manifest", manifestPath }));
    expect(state?.docId.startsWith("mfst_")).toBe(true);
  });

  it("errors when state already exists", async () => {
    const manifestPath = join(env.workDir, "cite.manifest.yaml");
    await runInit(["--manifest", manifestPath]);

    const result = await runInitExpectExit(["--manifest", manifestPath]);
    expect(result.errors.join("\n")).toContain(`Manifest ${resolve(manifestPath)} is already initialized. Use 'cite audit' to check its state.`);
  });

  it("errors when doc and manifest are both passed", async () => {
    const result = await runInitExpectExit(["--doc", "doc-1", "--manifest", join(env.workDir, "m.yaml")]);
    expect(result.errors.join("\n")).toContain("Pass at most one of --doc, --markdown, --manifest.");
  });

  it("errors when markdown and manifest are both passed", async () => {
    const result = await runInitExpectExit(["--markdown", join(env.workDir, "a.md"), "--manifest", join(env.workDir, "m.yaml")]);
    expect(result.errors.join("\n")).toContain("Pass at most one of --doc, --markdown, --manifest.");
  });
});

async function runInit(args: string[]): Promise<void> {
  const { registerInitCommand } = await import("../src/commands/init.js");
  vi.spyOn(console, "log").mockImplementation(() => {});
  const program = new Command();
  program.exitOverride();
  registerInitCommand(program);
  await program.parseAsync(["node", "cite", "init", ...args]);
}

async function runInitExpectExit(args: string[]): Promise<{ errors: string[] }> {
  const { registerInitCommand } = await import("../src/commands/init.js");
  const errors: string[] = [];
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation((message = "") => {
    errors.push(String(message));
  });
  vi.spyOn(process, "exit").mockImplementation((() => {
    throw new Error("process.exit");
  }) as never);
  const program = new Command();
  program.exitOverride();
  registerInitCommand(program);
  await expect(program.parseAsync(["node", "cite", "init", ...args])).rejects.toThrow("process.exit");
  return { errors };
}
