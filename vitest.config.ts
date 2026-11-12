import { defineConfig } from "vitest/config";
import { iconGroups } from "./scripts/icon-groups.mjs";
/* the same `import "sc-icons:…"` groups as the build (scripts/icon-groups.mjs) */
export default defineConfig({ plugins: [iconGroups()], test: { include: ["tests/unit/**/*.test.ts"], environment: "node" } });
