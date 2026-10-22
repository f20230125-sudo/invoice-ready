import { defineConfig, devices } from "@playwright/test";

// Locally against the dev server (npx vite on 5190); against the live site with BASE_URL=... npx playwright test
const remote = process.env.BASE_URL;

export default defineConfig({
  testDir: "./tests/e2e",
  workers: 1,
  expect: { timeout: 10_000 },
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: { baseURL: remote ?? "http://127.0.0.1:5190", trace: "retain-on-failure", reducedMotion: "reduce" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
});
