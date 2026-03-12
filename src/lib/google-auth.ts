// ABOUTME: Google OAuth2 authentication flow for the Docs API.
// ABOUTME: Runs a local HTTP server to capture the OAuth callback.

import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { google } from "googleapis";
import { getCiteDir, loadConfig, updateConfig } from "./config.js";
import { createServer } from "node:http";

const SCOPES = [
  "https://www.googleapis.com/auth/documents",
  "https://www.googleapis.com/auth/documents.readonly",
];

export interface GoogleCredentials {
  client_id: string;
  client_secret: string;
  redirect_uris: string[];
}

/**
 * Run the Google OAuth2 flow:
 * 1. Read client credentials from the configured path
 * 2. Open browser for user consent
 * 3. Capture the authorization code via local redirect
 * 4. Exchange for tokens and save
 */
export async function runGoogleAuthFlow(): Promise<void> {
  const config = await loadConfig();
  const credPath =
    config.google?.credentialsPath ??
    join(getCiteDir(), "google-credentials.json");
  const tokenPath =
    config.google?.tokenPath ?? join(getCiteDir(), "google-token.json");

  if (!existsSync(credPath)) {
    console.error(
      `Google credentials file not found at: ${credPath}\n` +
        `\nTo set up Google Docs API access:\n` +
        `1. Go to https://console.cloud.google.com/apis/credentials\n` +
        `2. Create an OAuth 2.0 Client ID (Desktop app)\n` +
        `3. Download the JSON and save it to: ${credPath}\n`,
    );
    process.exit(1);
  }

  const credRaw = await readFile(credPath, "utf-8");
  const credJson = JSON.parse(credRaw);
  const creds: GoogleCredentials = credJson.installed || credJson.web;

  if (!creds) {
    console.error("Invalid credentials file format. Expected 'installed' or 'web' key.");
    process.exit(1);
  }

  const oauth2Client = new google.auth.OAuth2(
    creds.client_id,
    creds.client_secret,
    "http://localhost:3000/callback",
  );

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent",
  });

  console.log(`\nOpen this URL in your browser to authorize:\n\n  ${authUrl}\n`);
  console.log("Waiting for authorization...");

  // Start a temporary local server to capture the callback
  const code = await new Promise<string>((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url!, `http://localhost:3000`);
      const authCode = url.searchParams.get("code");
      if (authCode) {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(
          "<h1>Authorization successful!</h1><p>You can close this window and return to the terminal.</p>",
        );
        server.close();
        resolve(authCode);
      } else {
        res.writeHead(400, { "Content-Type": "text/html" });
        res.end("<h1>Authorization failed</h1>");
        server.close();
        reject(new Error("No authorization code received"));
      }
    });
    server.listen(3000);
    server.on("error", reject);
  });

  const { tokens } = await oauth2Client.getToken(code);
  await writeFile(tokenPath, JSON.stringify(tokens, null, 2), "utf-8");

  await updateConfig({
    google: { credentialsPath: credPath, tokenPath },
  });

  console.log(`\nGoogle authentication successful! Token saved to: ${tokenPath}`);
}

/**
 * Get an authenticated Google OAuth2 client.
 * Returns null if no token is available.
 */
export async function getGoogleAuth() {
  const config = await loadConfig();
  const credPath =
    config.google?.credentialsPath ??
    join(getCiteDir(), "google-credentials.json");
  const tokenPath =
    config.google?.tokenPath ?? join(getCiteDir(), "google-token.json");

  if (!existsSync(credPath) || !existsSync(tokenPath)) {
    return null;
  }

  const credRaw = await readFile(credPath, "utf-8");
  const credJson = JSON.parse(credRaw);
  const creds: GoogleCredentials = credJson.installed || credJson.web;

  const oauth2Client = new google.auth.OAuth2(
    creds.client_id,
    creds.client_secret,
    "http://localhost:3000/callback",
  );

  const tokenRaw = await readFile(tokenPath, "utf-8");
  const tokens = JSON.parse(tokenRaw);
  oauth2Client.setCredentials(tokens);

  return oauth2Client;
}
