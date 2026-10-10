import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./test",
  testMatch: "*.spec.ts",
  timeout: 15000,
  workers: 1,
  outputDir: "./test-results",
  use: { browserName: "chromium", headless: true },
});
