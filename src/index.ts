#!/usr/bin/env node

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
import { ensureCiteDir } from "./lib/config.js";

const program = new Command();

program
  .name("cite")
  .description("CLI Citation Manager for Google Docs")
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

// Ensure ~/.cite directory structure exists
await ensureCiteDir();

program.parse();
