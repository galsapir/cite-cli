// ABOUTME: Verifies advisory locking across manifest-backed markdown sources.
// ABOUTME: Mocks proper-lockfile to observe acquisition and release ordering.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadManifest } from "../src/lib/manifest.js";
import { MultiMarkdownDocumentSource } from "../src/lib/multi-markdown-source.js";
import { MarkdownLockTimeoutError } from "../src/lib/markdown-source.js";

const { lockState, events, failPaths } = vi.hoisted(() => ({
  lockState: new Map<string, boolean>(),
  events: [] as string[],
  failPaths: new Set<string>(),
}));

vi.mock("proper-lockfile", () => ({
  default: {
    async lock(path: string, opts: { lockfilePath?: string }) {
      const lockPath = opts.lockfilePath ?? `${path}.lock`;
      events.push(`lock:${path}`);
      if (failPaths.has(path) || lockState.get(lockPath)) {
        const err: Error & { code?: string } = new Error("ELOCKED");
        err.code = "ELOCKED";
        throw err;
      }
      lockState.set(lockPath, true);
      return async () => {
        events.push(`release:${path}`);
        lockState.delete(lockPath);
      };
    },
  },
}));

let workDir: string;

beforeEach(async () => {
  lockState.clear();
  events.length = 0;
  failPaths.clear();
  workDir = await mkdtemp(join(tmpdir(), "cite-multi-md-lock-"));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

async function writeFileInDir(relativePath: string, content: string): Promise<string> {
  const filePath = resolve(workDir, relativePath);
  await writeFile(filePath, content, "utf-8");
  return filePath;
}

async function sourceFromManifest(text: string): Promise<MultiMarkdownDocumentSource> {
  const manifestPath = join(workDir, "cite.manifest.yaml");
  await writeFile(manifestPath, text, "utf-8");
  return new MultiMarkdownDocumentSource(await loadManifest(manifestPath));
}

describe("MultiMarkdownDocumentSource runWithLock", () => {
  it("acquires every body file and bibliography file", async () => {
    const aPath = await writeFileInDir("a.md", "# A\n");
    const bPath = await writeFileInDir("b.md", "# B\n");
    const bibPath = await writeFileInDir("references.md", "# Refs\n");
    const source = await sourceFromManifest("files:\n  - a.md\n  - b.md\nbibliography: references.md\n");

    await source.runWithLock(async () => undefined);

    expect(events.filter((event) => event.startsWith("lock:"))).toEqual([
      `lock:${aPath}`,
      `lock:${bPath}`,
      `lock:${bibPath}`,
    ]);
  });

  it("releases locks in reverse order on completion", async () => {
    const aPath = await writeFileInDir("a.md", "# A\n");
    const bPath = await writeFileInDir("b.md", "# B\n");
    const bibPath = await writeFileInDir("references.md", "# Refs\n");
    const source = await sourceFromManifest("files:\n  - a.md\n  - b.md\nbibliography: references.md\n");

    await source.runWithLock(async () => undefined);

    expect(events.filter((event) => event.startsWith("release:"))).toEqual([
      `release:${bibPath}`,
      `release:${bPath}`,
      `release:${aPath}`,
    ]);
  });

  it("releases acquired locks when a later acquire fails", async () => {
    const aPath = await writeFileInDir("a.md", "# A\n");
    const bPath = await writeFileInDir("b.md", "# B\n");
    await writeFileInDir("references.md", "# Refs\n");
    const source = await sourceFromManifest("files:\n  - a.md\n  - b.md\nbibliography: references.md\n");
    failPaths.add(bPath);

    await expect(source.runWithLock(async () => undefined)).rejects.toThrow(MarkdownLockTimeoutError);

    expect(events).toContain(`release:${aPath}`);
    expect(lockState.get(`${aPath}.cite.lock`)).toBeUndefined();
  });

  it("does not double-lock the bibliography when it is also a body file", async () => {
    const aPath = await writeFileInDir("a.md", "# A\n");
    const bibPath = await writeFileInDir("references.md", "# Refs\n");
    const source = await sourceFromManifest("files:\n  - a.md\n  - references.md\nbibliography: references.md\n");

    await source.runWithLock(async () => undefined);

    expect(events.filter((event) => event.startsWith("lock:"))).toEqual([
      `lock:${aPath}`,
      `lock:${bibPath}`,
    ]);
  });
});
