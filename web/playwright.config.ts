import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/e2e",
  // Runtime E2E owns a separate, explicitly offline Core/transport harness.
  testIgnore: "**/runtime-*.spec.ts",
  fullyParallel: false,
  workers: 1,
  reporter: [
    ["list"],
    [
      "json",
      { outputFile: "../review_evidence/workbench/playwright-results.json" },
    ],
  ],
  outputDir: "../review_evidence/workbench/browser-artifacts",
  use: {
    baseURL: "http://127.0.0.1:5173",
    channel: "msedge",
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: !process.env.CI,
  },
});
