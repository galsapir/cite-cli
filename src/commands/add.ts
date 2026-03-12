import { Command } from "commander";
import { confirm, select } from "@inquirer/prompts";
import chalk from "chalk";
import { resolve, searchByTitle, detectIdentifierType } from "../lib/resolver.js";
import { loadLibrary, addToLibrary, generateCiteKey } from "../lib/library.js";
import { addToZotero } from "../lib/zotero.js";
import { loadConfig } from "../lib/config.js";
import { formatReference } from "../lib/format.js";
import type { CslJson, LibraryEntry } from "../types/index.js";
import { readFile } from "node:fs/promises";

export function registerAddCommand(program: Command): void {
  program
    .command("add")
    .description("Add a reference to the library by DOI, URL, PMID, arXiv ID, or title")
    .argument("[identifier]", "DOI, URL, PMID, arXiv ID, or paper title")
    .option("--key <key>", "Override the auto-generated cite-key")
    .option("--file <path>", "Batch add from a file of DOIs (one per line)")
    .option("--bibtex <path>", "Import from BibTeX file")
    .option("--library <id>", "Target library (overrides default)")
    .option("-y, --yes", "Skip confirmation prompt")
    .action(async (identifier: string | undefined, opts) => {
      const config = await loadConfig();
      const libraryId =
        opts.library ||
        config.zotero?.defaultLibrary ||
        "local";
      const entries = await loadLibrary(libraryId);
      const existingKeys = entries.map((e) => e.key);

      if (opts.file) {
        await handleBatchFile(opts.file, libraryId, existingKeys, opts.yes);
        return;
      }

      if (!identifier) {
        console.error("Please provide a DOI, URL, PMID, arXiv ID, or paper title.");
        process.exit(1);
      }

      const idType = detectIdentifierType(identifier);

      // For title search, show multiple results
      if (idType === "title") {
        await handleTitleSearch(identifier, libraryId, existingKeys, opts.key, opts.yes);
        return;
      }

      try {
        console.log(`Resolving ${idType}: ${identifier}...`);
        const resolved = await resolve(identifier, existingKeys);

        const key = opts.key || resolved.suggestedKey;
        console.log(`\n${chalk.green("Resolved:")}`);
        console.log(`  ${formatReference(resolved.csl)}`);
        console.log(`  ${chalk.cyan("Cite-key:")} ${key}`);

        if (!opts.yes) {
          const ok = await confirm({
            message: "Add to library?",
            default: true,
          });
          if (!ok) {
            console.log("Skipped.");
            return;
          }
        }

        const entry: LibraryEntry = {
          key,
          csl: resolved.csl,
          addedAt: new Date().toISOString(),
        };

        // Add to Zotero (if configured)
        const zoteroKey = await addToZotero(libraryId, resolved.csl);
        if (zoteroKey) {
          entry.zoteroKey = zoteroKey;
          console.log(chalk.dim("  → Added to Zotero"));
        }

        // Add to local mirror
        await addToLibrary(libraryId, entry);
        console.log(chalk.green(`\n✓ Added [${key}] to library "${libraryId}"`));
      } catch (err: any) {
        console.error(chalk.red(`Error: ${err.message}`));
        process.exit(1);
      }
    });
}

async function handleTitleSearch(
  query: string,
  libraryId: string,
  existingKeys: string[],
  overrideKey?: string,
  skipConfirm?: boolean,
): Promise<void> {
  console.log(`Searching for: "${query}"...`);
  const results = await searchByTitle(query, 5);

  if (results.length === 0) {
    console.log(chalk.yellow("No results found."));
    return;
  }

  const choices = results.map((csl, i) => ({
    name: formatReference(csl),
    value: i,
  }));

  const selected = await select({
    message: "Select a paper:",
    choices,
  });

  const csl = results[selected];
  const key = overrideKey || generateCiteKey(csl, existingKeys);

  const entry: LibraryEntry = {
    key,
    csl,
    addedAt: new Date().toISOString(),
  };

  const zoteroKey = await addToZotero(libraryId, csl);
  if (zoteroKey) entry.zoteroKey = zoteroKey;

  await addToLibrary(libraryId, entry);
  console.log(chalk.green(`\n✓ Added [${key}] to library "${libraryId}"`));
}

async function handleBatchFile(
  filePath: string,
  libraryId: string,
  existingKeys: string[],
  skipConfirm?: boolean,
): Promise<void> {
  const content = await readFile(filePath, "utf-8");
  const lines = content
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));

  console.log(`Found ${lines.length} identifiers in ${filePath}`);

  let added = 0;
  let failed = 0;
  const keys = [...existingKeys];

  for (const line of lines) {
    try {
      const resolved = await resolve(line, keys);
      const key = resolved.suggestedKey;
      keys.push(key);

      console.log(`  ${chalk.green("✓")} ${formatReference(resolved.csl, key)}`);

      const entry: LibraryEntry = {
        key,
        csl: resolved.csl,
        addedAt: new Date().toISOString(),
      };

      await addToZotero(libraryId, resolved.csl);
      await addToLibrary(libraryId, entry);
      added++;
    } catch (err: any) {
      console.log(`  ${chalk.red("✗")} ${line}: ${err.message}`);
      failed++;
    }
  }

  console.log(
    `\nBatch complete: ${chalk.green(`${added} added`)}, ${chalk.red(`${failed} failed`)}`,
  );
}
