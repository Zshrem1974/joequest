import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  retries: 0,
  use: {
    baseURL: "http://127.0.0.1:3099",
    viewport: { width: 390, height: 844 },
  },
  webServer: {
    command: "node server.js",
    port: 3099,
    env: { PORT: "3099" },
    reuseExistingServer: !process.env.CI,
    timeout: 10_000,
  },
});
