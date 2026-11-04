import { defineConfig, devices } from "@playwright/test";

/* Browsers are preinstalled in this environment (PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers); never run `playwright install`.
   If the @playwright/test version ever stops matching them, set PW_CHROMIUM=/opt/pw-browsers/chromium. */
const exe = process.env.PW_CHROMIUM;

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30_000,
  use: { baseURL: "http://localhost:8788", ...(exe ? { launchOptions: { executablePath: exe } } : {}) },
  projects: [
    { name: "phone", use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 } } },
    { name: "desktop", use: { viewport: { width: 1440, height: 900 } } },
  ],
  webServer: {
    command: "npm run build && PORT=8788 DB_FILE=data/e2e.db node --experimental-strip-types --no-warnings server/index.ts",
    url: "http://localhost:8788/api/health",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
