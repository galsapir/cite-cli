// ABOUTME: Verifies source resolution for markdown manifest inputs.
// ABOUTME: Covers mutex behavior, init hints, and command guard errors.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setupCiteHome, type CiteHome } from "./helpers/cite-home.js";

let env: CiteHome;

beforeEach(async () => {
  env = await setupCiteHome("cite-resolve-manifest-");
});

afterEach(async () => {
  await env.teardown();
});

describe("resolveSource manifest support", () => {
  it("resolves manifest sources to MultiMarkdownDocumentSource", async () => {
    const manifestPath = await writeValidManifest();
    const { resolveSource } = await import("../src/lib/resolve-source.js");
    const resolved = await resolveSource({ manifest: manifestPath });
    expect(resolved.source.kind).toBe("markdown-manifest");
    expect(resolved.stateKey).toMatch(/^mfst_[a-f0-9]{12}$/);
  });

  it("errors when manifest and doc are both passed", async () => {
    const manifestPath = await writeValidManifest();
    const result = await expectResolveExit({ manifest: manifestPath, doc: "doc-1" });
    expect(result.stderr).toContain("Error: pass at most one of --doc, --markdown, --manifest.");
  });

  it("errors when manifest and markdown are both passed", async () => {
    const manifestPath = await writeValidManifest();
    const result = await expectResolveExit({ manifest: manifestPath, markdown: join(env.workDir, "a.md") });
    expect(result.stderr).toContain("Error: pass at most one of --doc, --markdown, --manifest.");
  });

  it("still errors when markdown and doc are both passed", async () => {
    const result = await expectResolveExit({ markdown: join(env.workDir, "a.md"), doc: "doc-1" });
    expect(result.stderr).toContain("Error: pass at most one of --doc, --markdown, --manifest.");
  });

  it("requireGoogleDocsSource rejects manifest sources", async () => {
    const manifestPath = await writeValidManifest();
    const { resolveSource, requireGoogleDocsSource } = await import("../src/lib/resolve-source.js");
    const resolved = await resolveSource({ manifest: manifestPath });
    const result = expectExit(() => requireGoogleDocsSource(resolved, "cmd"));
    expect(result.stderr).toContain("Error: 'cite cmd' is not yet manifest-aware.");
    expect(result.stderr).toContain(`Manifest: ${manifestPath}`);
  });

  it("rejectManifestSource rejects manifest sources", async () => {
    const manifestPath = await writeValidManifest();
    const { resolveSource, rejectManifestSource } = await import("../src/lib/resolve-source.js");
    const resolved = await resolveSource({ manifest: manifestPath });
    const result = expectExit(() => rejectManifestSource(resolved, "cmd"));
    expect(result.stderr).toContain("Error: 'cite cmd' does not yet support --manifest mode (Phase 2/3 of issue #20).");
    expect(result.stderr).toContain(`Manifest: ${manifestPath}`);
  });

  it("formats the manifest init hint", async () => {
    const manifestPath = await writeValidManifest();
    const { resolveSource, initHintForSource } = await import("../src/lib/resolve-source.js");
    const resolved = await resolveSource({ manifest: manifestPath });
    expect(initHintForSource(resolved)).toBe(`cite init --manifest ${manifestPath}`);
  });

  it("uses defaults.manifest when no explicit source is passed", async () => {
    const manifestPath = await writeValidManifest();
    const { updateConfig } = await import("../src/lib/config.js");
    await updateConfig({ defaults: { manifest: manifestPath } });
    const { resolveSource } = await import("../src/lib/resolve-source.js");

    const resolved = await resolveSource({});

    expect(resolved.source.kind).toBe("markdown-manifest");
    expect(resolved.options.manifest).toBe(manifestPath);
  });

  it("prefers defaults.manifest over defaults.markdown", async () => {
    const manifestPath = await writeValidManifest();
    const markdownPath = join(env.workDir, "a.md");
    const { updateConfig } = await import("../src/lib/config.js");
    await updateConfig({ defaults: { manifest: manifestPath, markdown: markdownPath } });
    const { resolveSource } = await import("../src/lib/resolve-source.js");

    const resolved = await resolveSource({});

    expect(resolved.source.kind).toBe("markdown-manifest");
    expect(resolved.options.manifest).toBe(manifestPath);
  });

  it("lets explicit markdown override defaults.manifest", async () => {
    const manifestPath = await writeValidManifest();
    const markdownPath = join(env.workDir, "a.md");
    const { updateConfig } = await import("../src/lib/config.js");
    await updateConfig({ defaults: { manifest: manifestPath } });
    const { resolveSource } = await import("../src/lib/resolve-source.js");

    const resolved = await resolveSource({ markdown: markdownPath });

    expect(resolved.source.kind).toBe("markdown");
    expect(resolved.options.markdown).toBe(markdownPath);
  });

  it("lets explicit doc override defaults.manifest", async () => {
    const manifestPath = await writeValidManifest();
    const { updateConfig } = await import("../src/lib/config.js");
    await updateConfig({ defaults: { manifest: manifestPath } });
    const { resolveSource } = await import("../src/lib/resolve-source.js");

    const resolved = await resolveSource({ doc: "doc-1" });

    expect(resolved.source.kind).toBe("google-docs");
    expect(resolved.options.doc).toBe("doc-1");
  });
});

async function writeValidManifest(): Promise<string> {
  const markdownPath = join(env.workDir, "a.md");
  await writeFile(markdownPath, "# A\n", "utf-8");
  const manifestPath = join(env.workDir, "cite.manifest.yaml");
  await writeFile(manifestPath, "files:\n  - a.md\nbibliography: references.md\n", "utf-8");
  return manifestPath;
}

async function expectResolveExit(opts: { doc?: string; markdown?: string; manifest?: string }): Promise<{ stderr: string }> {
  const { resolveSource } = await import("../src/lib/resolve-source.js");
  return expectExitAsync(() => resolveSource(opts));
}

function expectExit(fn: () => void): { stderr: string } {
  const writes: string[] = [];
  vi.spyOn(process.stderr, "write").mockImplementation(((chunk: string | Uint8Array) => {
    writes.push(String(chunk));
    return true;
  }) as never);
  vi.spyOn(process, "exit").mockImplementation((() => {
    throw new Error("process.exit");
  }) as never);
  expect(fn).toThrow("process.exit");
  return { stderr: writes.join("") };
}

async function expectExitAsync(fn: () => Promise<unknown>): Promise<{ stderr: string }> {
  const writes: string[] = [];
  vi.spyOn(process.stderr, "write").mockImplementation(((chunk: string | Uint8Array) => {
    writes.push(String(chunk));
    return true;
  }) as never);
  vi.spyOn(process, "exit").mockImplementation((() => {
    throw new Error("process.exit");
  }) as never);
  await expect(fn()).rejects.toThrow("process.exit");
  return { stderr: writes.join("") };
}
