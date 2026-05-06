#!/usr/bin/env node
// ABOUTME: Entry point for the cite CLI.
// ABOUTME: Registers all commands and initializes the config directory.

import { Command } from "commander";
import { registerAuthCommands } from "./commands/auth.js";
import { registerAddCommand } from "./commands/add.js";
import { registerSearchCommand } from "./commands/search.js";
import { registerInitCommand } from "./commands/init.js";
import { registerInsertCommand } from "./commands/insert.js";
import { registerBibCommand } from "./commands/bib.js";
import { registerAuditCommand } from "./commands/audit.js";
import { registerImportCommand } from "./commands/import.js";
import { registerSyncCommand } from "./commands/sync.js";
import { registerRemoveCommand } from "./commands/remove.js";
import { registerConfigCommand } from "./commands/config-cmd.js";
import { registerRefreshCommand } from "./commands/refresh.js";
import { registerScanCommand } from "./commands/scan.js";
import { registerUseCommand } from "./commands/use.js";
import { registerExportCommand } from "./commands/export.js";
import { ensureCiteDir } from "./lib/config.js";

const program = new Command();

program
  .name("cite")
  .description("Markdown-first citation manager: multi-file manifests, single-file markdown, and Google Docs")
  .version("0.1.0");

// Register all commands
registerAuthCommands(program);
registerAddCommand(program);
registerSearchCommand(program);
registerInitCommand(program);
registerInsertCommand(program);
registerBibCommand(program);
registerAuditCommand(program);
registerImportCommand(program);
registerSyncCommand(program);
registerRemoveCommand(program);
registerConfigCommand(program);
registerRefreshCommand(program);
registerScanCommand(program);
registerUseCommand(program);
registerExportCommand(program);

// Ensure ~/.cite directory structure exists
await ensureCiteDir();

program.parse();
