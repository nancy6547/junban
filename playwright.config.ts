import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "demo/tests",
  timeout: 15_000,
  expect: { timeout: 1_500 },
  retries: 0,
  reporter: "line",
  use: {
    baseURL: "http://localhost:4310",
    // Set CHROME_PATH to use a specific Chrome/Chromium binary.
    launchOptions: process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {},
  },
  webServer: {
    command: "npx tsx demo/server.ts",
    url: "http://localhost:4310",
    reuseExistingServer: true,
  },
});
