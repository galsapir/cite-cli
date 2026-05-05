// ABOUTME: CLI command to export a Google Doc tab as a markdown file.
// ABOUTME: Read-only against the source doc; writes markdown + extracted images locally.

import { Command } from "commander";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve as resolvePath } from "node:path";
import chalk from "chalk";
import { exportTabAsMarkdown } from "../lib/markdown-export.js";
import { resolveDocId } from "../lib/config.js";

export function registerExportCommand(program: Command): void {
  program
    .command("export")
    .description("Export a Google Doc tab to a markdown file (read-only)")
    .option("--doc <docId>", "Google Doc ID")
    .option("--tab <index>", "Tab index to export (0 = first tab)", "0")
    .option("--format <fmt>", "Output format", "md")
    .option("--out <path>", "Output markdown file path", "doc.md")
    .option("--image-dir <dir>", "Directory to write extracted images", "./figures")
    .action(async (opts) => {
      if (opts.format !== "md") {
        console.error(chalk.red(`Unsupported format: ${opts.format}. Only "md" is supported.`));
        process.exit(1);
      }

      const docId = await resolveDocId(opts.doc);
      const tabIndex = Number.parseInt(opts.tab, 10);
      if (Number.isNaN(tabIndex) || tabIndex < 0) {
        console.error(chalk.red(`Invalid --tab value: ${opts.tab}`));
        process.exit(1);
      }

      const outPath = resolvePath(process.cwd(), opts.out);
      const imageDirAbs = resolvePath(process.cwd(), opts.imageDir);
      const imageDirRel = relPathForMarkdown(outPath, imageDirAbs);

      console.log(chalk.dim(`Fetching tab ${tabIndex} of ${docId}...`));
      const result = await exportTabAsMarkdown(docId, {
        tabIndex,
        imagePrefix: docId,
        imageDirRelPath: imageDirRel,
      });

      await mkdir(dirname(outPath), { recursive: true });
      await writeFile(outPath, result.markdown, "utf-8");
      console.log(chalk.green(`✓ Wrote ${result.markdown.length} chars to ${opts.out}`));

      if (result.images.length > 0) {
        await mkdir(imageDirAbs, { recursive: true });
        for (const img of result.images) {
          await writeFile(resolvePath(imageDirAbs, img.filename), img.bytes);
        }
        console.log(chalk.green(`✓ Extracted ${result.images.length} image(s) to ${opts.imageDir}`));
      }

      if (result.warnings.length > 0) {
        console.log(chalk.yellow(`\n${result.warnings.length} warning(s):`));
        for (const w of result.warnings) console.log(chalk.yellow(`  - ${w}`));
      }
    });
}

/** Compute the path that should appear inside markdown image links. */
function relPathForMarkdown(outFile: string, imageDir: string): string {
  const rel = relative(dirname(outFile), imageDir);
  if (rel === "") return ".";
  if (isAbsolute(rel)) return imageDir;
  return rel.startsWith(".") ? rel : `./${rel}`;
}
