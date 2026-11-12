import { defineConfig, devices } from "@playwright/test";

/* Browsers are preinstalled in this environment (PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers); never run `playwright install`.
   If the @playwright/test version ever stops matching them, set PW_CHROMIUM=/opt/pw-browsers/chromium. */
const exe = process.env.PW_CHROMIUM;
/* parallel work: E2E_PORT and DIST_DIR give each agent its own server and build folder (defaults: 8788, dist).
   SC_PREVIEW_API=1: test mode only, the API follows the preview clock of the page (?preview=1&t=..), never in production. */
const port = +(process.env.E2E_PORT || 8788);
const dist = process.env.DIST_DIR || "dist";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30_000,
  use: { baseURL: "http://localhost:" + port, ...(exe ? { launchOptions: { executablePath: exe } } : {}) },
  projects: [
    { name: "phone", use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 } } },
    { name: "desktop", use: { viewport: { width: 1440, height: 900 } } },
  ],
  webServer: {
    command: `npm run gen && npx astro build --outDir ${dist} && PORT=${port} DIST_DIR=${dist} DB_FILE=data/e2e-${port}.db SC_PREVIEW_API=1 node --experimental-strip-types --no-warnings server/index.ts`,
    url: "http://localhost:" + port + "/api/health",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
