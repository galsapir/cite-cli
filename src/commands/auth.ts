// ABOUTME: CLI command for setting up authentication credentials.
// ABOUTME: Handles Google OAuth2 and Zotero API key configuration.

import { Command } from "commander";
import { confirm, input } from "@inquirer/prompts";
import { runGoogleAuthFlow } from "../lib/google-auth.js";
import { setupZoteroAuth } from "../lib/zotero.js";

export function registerAuthCommands(program: Command): void {
  const auth = program
    .command("auth")
    .description("Set up authentication for external services");

  auth
    .command("google")
    .description("Set up Google Docs API authentication (OAuth2)")
    .action(async () => {
      console.log("Setting up Google Docs API authentication...\n");
      await runGoogleAuthFlow();
    });

  auth
    .command("zotero")
    .description("Set up Zotero API authentication")
    .action(async () => {
      console.log("Setting up Zotero API authentication...\n");
      console.log(
        "Get your API key from: https://www.zotero.org/settings/keys\n",
      );

      const apiKey = await input({
        message: "Zotero API key:",
      });

      const userId = await input({
        message: "Zotero user ID (from https://www.zotero.org/settings/keys):",
      });

      const useGroup = await confirm({
        message: "Do you want to use a group library (for collaboration)?",
        default: true,
      });

      let defaultLibrary: string | undefined;
      if (useGroup) {
        const groupId = await input({
          message: "Group library ID:",
        });
        defaultLibrary = `group/${groupId}`;
      }

      await setupZoteroAuth(apiKey, userId, defaultLibrary);
      console.log("\nZotero authentication configured successfully!");
    });
}
