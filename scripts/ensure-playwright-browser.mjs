import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { chromium } from "playwright";

const executablePath = chromium.executablePath();

if (existsSync(executablePath)) {
  console.log(`[browser] Playwright Chromium is ready: ${executablePath}`);
  process.exit(0);
}

console.log("[browser] Playwright Chromium is missing. Installing it for this computer...");

const require = createRequire(import.meta.url);
const playwrightPackage = require.resolve("playwright/package.json");
const playwrightCli = path.join(path.dirname(playwrightPackage), "cli.js");
const result = spawnSync(process.execPath, [playwrightCli, "install", "chromium"], {
  stdio: "inherit",
  shell: false
});

if (result.error) {
  console.error(`[browser] Failed to start the Playwright installer: ${result.error.message}`);
  process.exit(1);
}

if (result.status !== 0 || !existsSync(executablePath)) {
  console.error("[browser] Chromium installation failed. Check the network, then run: npm run browser:install");
  process.exit(result.status || 1);
}

console.log(`[browser] Playwright Chromium installed successfully: ${executablePath}`);
