// ABOUTME: Manages the ~/.cite/ directory and config.yaml settings.
// ABOUTME: Provides load/save/update for global configuration.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { CiteConfig } from "../types/index.js";

const CITE_DIR = join(homedir(), ".cite");
const CONFIG_PATH = join(CITE_DIR, "config.yaml");

export function getCiteDir(): string {
  return CITE_DIR;
}

export function getConfigPath(): string {
  return CONFIG_PATH;
}

export async function ensureCiteDir(): Promise<void> {
  await mkdir(join(CITE_DIR, "libraries"), { recursive: true });
  await mkdir(join(CITE_DIR, "docs"), { recursive: true });
}

export async function loadConfig(): Promise<CiteConfig> {
  await ensureCiteDir();
  try {
    const raw = await readFile(CONFIG_PATH, "utf-8");
    return (parseYaml(raw) as CiteConfig) ?? {};
  } catch (err: any) {
    if (err.code === "ENOENT") return {};
    throw err;
  }
}

export async function saveConfig(config: CiteConfig): Promise<void> {
  await ensureCiteDir();
  const yaml = stringifyYaml(config);
  await writeFile(CONFIG_PATH, yaml, "utf-8");
}

export async function updateConfig(
  updates: Partial<CiteConfig>,
): Promise<CiteConfig> {
  const config = await loadConfig();
  const merged = deepMerge(config, updates);
  await saveConfig(merged);
  return merged;
}

/** Resolve the effective doc ID from a CLI flag or the active default */
export async function resolveDocId(cliDocId?: string): Promise<string> {
  if (cliDocId) return cliDocId;
  const config = await loadConfig();
  const defaultDoc = config.defaults?.doc;
  if (defaultDoc) return defaultDoc;
  console.error("No --doc specified and no active document set. Use 'cite use --doc <ID>' or pass --doc.");
  process.exit(1);
}

function deepMerge(target: Record<string, any>, source: Record<string, any>): Record<string, any> {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (
      source[key] &&
      typeof source[key] === "object" &&
      !Array.isArray(source[key]) &&
      target[key] &&
      typeof target[key] === "object"
    ) {
      result[key] = deepMerge(target[key], source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}
