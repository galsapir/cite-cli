// ABOUTME: Verifies per-file advisory locking for single markdown sources.
// ABOUTME: Mocks proper-lockfile so lock behavior is deterministic in unit tests.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MarkdownDocumentSource,
  MarkdownLockTimeoutError,
} from "../src/lib/markdown-source.js";

const { lockState } = vi.hoisted(() => ({
  lockState: new Map<string, boolean>(),
}));

vi.mock("proper-lockfile", () => ({
  default: {
    async lock(path: string, opts: { lockfilePath?: string }) {
      const lockPath = opts.lockfilePath ?? `${path}.lock`;
      if (lockState.get(lockPath)) {
        const err: Error & { code?: string } = new Error("ELOCKED");
        err.code = "ELOCKED";
        throw err;
      }
      lockState.set(lockPath, true);
      return async () => {
        lockState.delete(lockPath);
      };
    },
  },
}));

let workDir: string;

beforeEach(async () => {
  lockState.clear();
  workDir = await mkdtemp(join(tmpdir(), "cite-md-lock-"));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

async function withFile(content: string): Promise<MarkdownDocumentSource> {
  const filePath = join(workDir, "doc.md");
  await writeFile(filePath, content, "utf-8");
  return new MarkdownDocumentSource(filePath);
}

describe("MarkdownDocumentSource runWithLock", () => {
  it("invokes the operation and returns its result", async () => {
    const source = await withFile("# Title\n");

    await expect(source.runWithLock(async () => "done")).resolves.toBe("done");
  });

  it("releases the lock after the operation completes", async () => {
    const source = await withFile("# Title\n");

    await source.runWithLock(async () => undefined);

    await expect(source.runWithLock(async () => "again")).resolves.toBe("again");
  });

  it("releases the lock when the operation throws", async () => {
    const source = await withFile("# Title\n");

    await expect(source.runWithLock(async () => {
      throw new Error("boom");
    })).rejects.toThrow("boom");

    await expect(source.runWithLock(async () => "again")).resolves.toBe("again");
  });

  it("throws MarkdownLockTimeoutError when the file is already locked", async () => {
    const source = await withFile("# Title\n");
    const lockPath = `${source.filePath}.cite.lock`;
    lockState.set(lockPath, true);

    await expect(source.runWithLock(async () => undefined)).rejects.toThrow(MarkdownLockTimeoutError);
    await expect(source.runWithLock(async () => undefined)).rejects.toThrow(source.filePath);
  });
});
