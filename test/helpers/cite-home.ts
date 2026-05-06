// ABOUTME: Test fixture that points the cite home dir at a fresh tmpdir for the duration of a test.
// ABOUTME: Swaps process.env.HOME so getCiteDir() resolves under the tmp; teardown restores HOME.

import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { vi } from "vitest";

export interface CiteHome {
  workDir: string;
  teardown(): Promise<void>;
}

/**
 * Set up an isolated cite home dir + reset module cache.
 *
 * Vitest runs test files in separate worker processes, so swapping
 * `process.env.HOME` is safe within a file's lifetime; tests within the
 * file run serially and share this single env.
 */
export async function setupCiteHome(prefix = "cite-test-"): Promise<CiteHome> {
  const workDir = await mkdtemp(join(tmpdir(), prefix));
  const originalHome = process.env.HOME;
  process.env.HOME = join(workDir, "home");
  await mkdir(join(process.env.HOME, ".cite", "docs"), { recursive: true });
  await mkdir(join(process.env.HOME, ".cite", "libraries"), { recursive: true });
  vi.resetModules();

  return {
    workDir,
    async teardown() {
      if (originalHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = originalHome;
      }
      vi.restoreAllMocks();
      await rm(workDir, { recursive: true, force: true });
    },
  };
}
