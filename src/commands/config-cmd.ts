import { Command } from "commander";
import chalk from "chalk";
import { loadConfig, updateConfig } from "../lib/config.js";
import { loadDocState, saveDocState } from "../lib/doc-state.js";
import { stringify as stringifyYaml } from "yaml";

export function registerConfigCommand(program: Command): void {
  const configCmd = program
    .command("config")
    .description("View or update configuration");

  configCmd
    .command("show")
    .description("Show current configuration")
    .action(async () => {
      const config = await loadConfig();
      // Redact API keys
      const display = JSON.parse(JSON.stringify(config));
      if (display.zotero?.apiKey) {
        display.zotero.apiKey = display.zotero.apiKey.slice(0, 4) + "****";
      }
      console.log(stringifyYaml(display));
    });

  configCmd
    .command("style")
    .description("Set the default citation style")
    .argument("<style>", "Citation style (vancouver, apa, nature, ieee, chicago-author-date)")
    .option("--doc <docId>", "Set style for a specific document only")
    .action(async (style: string, opts) => {
      const validStyles = ["vancouver", "apa", "nature", "ieee", "chicago-author-date"];
      if (!validStyles.includes(style)) {
        console.error(
          chalk.red(`Invalid style "${style}". Valid: ${validStyles.join(", ")}`),
        );
        process.exit(1);
      }

      if (opts.doc) {
        const docState = await loadDocState(opts.doc);
        if (!docState) {
          console.error(chalk.red(`Doc ${opts.doc} not initialized.`));
          process.exit(1);
        }
        docState.style = style;
        await saveDocState(docState);
        console.log(chalk.green(`✓ Document style set to "${style}"`));
      } else {
        await updateConfig({ defaults: { style } });
        console.log(chalk.green(`✓ Default style set to "${style}"`));
      }
    });

  configCmd
    .command("set")
    .description("Set a config value (dot-notation: defaults.confirmBeforeWrite)")
    .argument("<key>", "Config key in dot-notation")
    .argument("<value>", "Value to set")
    .action(async (key: string, value: string) => {
      const config = await loadConfig();
      const parts = key.split(".");
      let obj: any = config;

      for (let i = 0; i < parts.length - 1; i++) {
        if (!obj[parts[i]]) obj[parts[i]] = {};
        obj = obj[parts[i]];
      }

      // Parse boolean/number values
      let parsed: any = value;
      if (value === "true") parsed = true;
      else if (value === "false") parsed = false;
      else if (!isNaN(Number(value))) parsed = Number(value);

      obj[parts[parts.length - 1]] = parsed;
      await updateConfig(config);
      console.log(chalk.green(`✓ ${key} = ${parsed}`));
    });
}
