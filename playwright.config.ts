import { defineConfig, devices } from "@playwright/test";
import { readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

function hasInstalledWebKit(): boolean {
  try {
    return readdirSync(join(homedir(), ".cache", "ms-playwright")).some(
      (name) => name.startsWith("webkit-"),
    );
  } catch {
    return false;
  }
}

const webkitAvailable = hasInstalledWebKit();

/**
 * Configuração Playwright para testes E2E das F3–F5.
 * O WebKit só entra quando o binário já está instalado; `test:e2e` continua
 * executável em ambientes de CI locais que têm apenas Chromium.
 * @see https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false, // Testes E2E compartilham servidor
  forbidOnly: !!process.env["CI"],
  retries: process.env["CI"] ? 2 : 0,
  workers: 1, // Um worker para evitar conflitos de servidor
  reporter: process.env["CI"] ? "list" : "html",
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
    ...(webkitAvailable
      ? [
          {
            name: "mobile-webkit",
            use: { ...devices["iPhone 13"], browserName: "webkit" as const },
          },
        ]
      : []),
  ],

  webServer: [
    {
      command: "pnpm --filter @trucoviski/server dev",
      url: "http://127.0.0.1:2568/healthz",
      reuseExistingServer: !process.env["CI"],
      timeout: 120 * 1000,
    },
    {
      command:
        "VITE_SERVER_URL=http://127.0.0.1:2568 pnpm --filter @trucoviski/web dev",
      url: "http://localhost:5173",
      reuseExistingServer: !process.env["CI"],
      timeout: 120 * 1000,
    },
  ],
});
