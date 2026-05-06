// ABOUTME: Loads and validates multi-file markdown manifest YAML files.
// ABOUTME: Resolves manuscript and bibliography paths relative to the manifest.

import { readFile, access } from "node:fs/promises";
import { dirname, isAbsolute, resolve as resolvePath } from "node:path";
import { parse } from "yaml";

export interface Manifest {
  manifestPath: string;
  manifestDir: string;
  bodyFilePaths: string[];
  bibFilePath: string;
}

export class ManifestLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ManifestLoadError";
  }
}

interface FileEntry {
  entry: string;
  absPath: string;
}

export async function loadManifest(manifestPath: string): Promise<Manifest> {
  const abs = resolvePath(manifestPath);
  const manifestDir = dirname(abs);
  const raw = await readManifestText(abs);
  const parsed = parseManifest(raw, abs);

  validateManifestObject(parsed, abs);
  const files = parsed.files as unknown[];
  const bibliography = parsed.bibliography as unknown;

  if (!Array.isArray(files)) {
    throw new ManifestLoadError(`Manifest at ${abs} key 'files' must be an array.`);
  }
  if (typeof bibliography !== "string") {
    throw new ManifestLoadError(`Manifest at ${abs} key 'bibliography' must be a string.`);
  }

  const fileEntries = files.map((entry, index) => validateFileEntry(entry, index, manifestDir));
  const bibEntry = validateRelativePath(bibliography, manifestDir);
  detectDuplicateFiles(fileEntries, abs);
  await validateExistingFiles(fileEntries);

  const bodyFilePaths = fileEntries
    .map((entry) => entry.absPath)
    .filter((filePath) => filePath !== bibEntry.absPath);

  return {
    manifestPath: abs,
    manifestDir,
    bodyFilePaths,
    bibFilePath: bibEntry.absPath,
  };
}

async function readManifestText(abs: string): Promise<string> {
  try {
    return await readFile(abs, "utf-8");
  } catch (err: any) {
    if (err.code === "ENOENT") {
      throw new ManifestLoadError(
        `Manifest not found at ${abs}. Run 'cite init --manifest <path>' to create one.`,
      );
    }
    throw err;
  }
}

function parseManifest(raw: string, abs: string): unknown {
  try {
    return parse(raw);
  } catch (err: any) {
    const detail = String(err.message).replace(/\s+/g, " ").trim();
    throw new ManifestLoadError(
      `Manifest at ${abs} is not valid YAML: ${detail}. Fix the syntax error and re-run.`,
    );
  }
}

function validateManifestObject(parsed: unknown, abs: string): asserts parsed is Record<string, unknown> {
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ManifestLoadError(`Manifest at ${abs} must be a YAML object.`);
  }
  if (!("files" in parsed)) {
    throw new ManifestLoadError(`Manifest at ${abs} missing required key 'files'.`);
  }
  if (!("bibliography" in parsed)) {
    throw new ManifestLoadError(`Manifest at ${abs} missing required key 'bibliography'.`);
  }
}

function validateFileEntry(entry: unknown, index: number, manifestDir: string): FileEntry {
  if (typeof entry !== "string") {
    throw new ManifestLoadError(`Manifest key 'files' entry files[${index}] must be a string.`);
  }
  return validateRelativePath(entry, manifestDir);
}

function validateRelativePath(entry: string, manifestDir: string): FileEntry {
  if (isAbsolute(entry)) {
    throw new ManifestLoadError(
      `Manifest entry '${entry}' is an absolute path; manifest paths must be relative to ${manifestDir}.`,
    );
  }
  return { entry, absPath: resolvePath(manifestDir, entry) };
}

function detectDuplicateFiles(fileEntries: FileEntry[], manifestPath: string): void {
  const seen = new Map<string, string>();
  for (const fileEntry of fileEntries) {
    const previous = seen.get(fileEntry.absPath);
    if (previous !== undefined) {
      throw new ManifestLoadError(
        `Manifest ${manifestPath} lists '${fileEntry.entry}' twice. Each file may appear at most once under 'files:'.`,
      );
    }
    seen.set(fileEntry.absPath, fileEntry.entry);
  }
}

async function validateExistingFiles(fileEntries: FileEntry[]): Promise<void> {
  for (const fileEntry of fileEntries) {
    await assertExists(fileEntry);
  }
}

async function assertExists(fileEntry: FileEntry): Promise<void> {
  try {
    await access(fileEntry.absPath);
  } catch (err: any) {
    if (err.code === "ENOENT") {
      throw new ManifestLoadError(
        `Manifest entry '${fileEntry.entry}' resolves to ${fileEntry.absPath} which does not exist. Create the file or remove the entry.`,
      );
    }
    throw err;
  }
}
