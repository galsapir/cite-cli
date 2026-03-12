// ABOUTME: CLI commands to import references from BibTeX, RIS, and SciWheel.
// ABOUTME: Parses external formats and adds entries to the local library.

import { Command } from "commander";
import { confirm, input } from "@inquirer/prompts";
import chalk from "chalk";
import { readFile } from "node:fs/promises";
import { parseBibtex, parseRis } from "../lib/bibtex-parser.js";
import { loadLibrary, addToLibrary, generateCiteKey } from "../lib/library.js";
import { addToZotero } from "../lib/zotero.js";
import { loadConfig } from "../lib/config.js";
import { formatReference } from "../lib/format.js";
import type { LibraryEntry, CslJson } from "../types/index.js";

export function registerImportCommand(program: Command): void {
  const importCmd = program
    .command("import")
    .description("Import references from external sources");

  importCmd
    .command("bibtex")
    .description("Import references from a BibTeX file")
    .argument("<file>", "Path to BibTeX file")
    .option("--library <id>", "Target library (overrides default)")
    .option("-y, --yes", "Skip confirmation prompt")
    .action(async (file: string, opts) => {
      await importFromFile(file, "bibtex", opts);
    });

  importCmd
    .command("ris")
    .description("Import references from a RIS file")
    .argument("<file>", "Path to RIS file")
    .option("--library <id>", "Target library (overrides default)")
    .option("-y, --yes", "Skip confirmation prompt")
    .action(async (file: string, opts) => {
      await importFromFile(file, "ris", opts);
    });

  importCmd
    .command("sciwheel")
    .description("One-time import from SciWheel project (exports as BibTeX)")
    .option("--project <id>", "SciWheel project ID")
    .option("--token <token>", "SciWheel API bearer token")
    .option("--library <id>", "Target library (overrides default)")
    .option("-y, --yes", "Skip confirmation prompt")
    .action(async (opts) => {
      const projectId = opts.project;
      const token = opts.token;

      if (!projectId || !token) {
        console.error(
          chalk.red("Both --project and --token are required for SciWheel import."),
        );
        console.log(
          "\nGet your token from SciWheel account settings.\nExample:\n" +
            "  cite import sciwheel --project 726868 --token YOUR_TOKEN\n",
        );
        process.exit(1);
      }

      console.log(`Fetching references from SciWheel project ${projectId}...`);

      try {
        const url = `https://sciwheel.com/extapi/work/references/export?projectId=${projectId}&exportType=BIBTEX`;
        const resp = await fetch(url, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (!resp.ok) {
          throw new Error(`SciWheel API error: ${resp.status} ${resp.statusText}`);
        }

        const bibtex = await resp.text();
        const cslEntries = parseBibtex(bibtex);

        if (cslEntries.length === 0) {
          console.log(chalk.yellow("No references found in SciWheel export."));
          return;
        }

        await importCslEntries(cslEntries, opts);
      } catch (err: any) {
        console.error(chalk.red(`Error: ${err.message}`));
        process.exit(1);
      }
    });
}

async function importFromFile(
  filePath: string,
  format: "bibtex" | "ris",
  opts: any,
): Promise<void> {
  let content: string;
  try {
    content = await readFile(filePath, "utf-8");
  } catch {
    console.error(chalk.red(`File not found: ${filePath}`));
    process.exit(1);
  }

  const cslEntries = format === "bibtex" ? parseBibtex(content) : parseRis(content);

  if (cslEntries.length === 0) {
    console.log(chalk.yellow(`No references found in ${filePath}.`));
    return;
  }

  console.log(`Found ${cslEntries.length} references in ${filePath}:\n`);
  for (const csl of cslEntries) {
    console.log(`  ${formatReference(csl)}`);
  }
  console.log("");

  await importCslEntries(cslEntries, opts);
}

async function importCslEntries(
  cslEntries: CslJson[],
  opts: any,
): Promise<void> {
  const config = await loadConfig();
  const libraryId = opts.library || config.zotero?.defaultLibrary || "local";

  console.log(`Importing ${cslEntries.length} references to library "${libraryId}"...`);

  if (!opts.yes) {
    const ok = await confirm({
      message: `Import ${cslEntries.length} references?`,
      default: true,
    });
    if (!ok) {
      console.log("Cancelled.");
      return;
    }
  }

  const existing = await loadLibrary(libraryId);
  const existingKeys = existing.map((e) => e.key);
  let added = 0;
  let failed = 0;

  for (const csl of cslEntries) {
    try {
      const key = generateCiteKey(csl, existingKeys);
      existingKeys.push(key);

      const entry: LibraryEntry = {
        key,
        csl,
        addedAt: new Date().toISOString(),
      };

      // Try to add to Zotero (best-effort)
      const zoteroKey = await addToZotero(libraryId, csl);
      if (zoteroKey) entry.zoteroKey = zoteroKey;

      await addToLibrary(libraryId, entry);
      console.log(`  ${chalk.green("✓")} [${key}] ${csl.title || "Untitled"}`);
      added++;
    } catch (err: any) {
      console.log(`  ${chalk.red("✗")} ${csl.title || "Unknown"}: ${err.message}`);
      failed++;
    }
  }

  console.log(
    `\nImport complete: ${chalk.green(`${added} added`)}, ${chalk.red(`${failed} failed`)}`,
  );
}
