import { defineConfig, devices } from "@playwright/test";

/**
 * Configuração Playwright para testes E2E da F3.
 * @see https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false, // Testes E2E compartilham servidor
  forbidOnly: !!process.env["CI"],
  retries: process.env["CI"] ? 2 : 0,
  workers: 1, // Um worker para evitar conflitos de servidor
  reporter: "html",
  use: {
    baseURL: "http://localhost:5173",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile-chromium",
      use: { ...devices["Pixel 5"] },
    },
  ],

  webServer: [
    {
      command: "pnpm --filter @trucoviski/server dev",
      port: 2568,
      reuseExistingServer: !process.env["CI"],
      timeout: 120 * 1000,
    },
    {
      command: "pnpm --filter @trucoviski/web dev",
      port: 5173,
      reuseExistingServer: !process.env["CI"],
      timeout: 120 * 1000,
    },
  ],
});
