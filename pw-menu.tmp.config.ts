import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "/home/user/siracusa-sofia/tests/e2e", timeout: 30_000, outputDir: "/tmp/claude-0/-home-user-siracusa-sofia/039e0469-eabb-56a0-a5d9-b63a498d648a/scratchpad/pw-out",
  use: { baseURL: process.env.BASE || "http://localhost:8802" },
  projects: [
    { name: "phone", use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 } } },
    { name: "desktop", use: { viewport: { width: 1440, height: 900 } } },
  ],
});
