import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  fullyParallel: false,
  workers: 1,
  timeout: 45000,
  expect: { timeout: 10000 },
  reporter: "list",
  use: {
    baseURL: "http://localhost:5184",
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
    viewport: { width: 390, height: 844 },
  },
  webServer: {
    command:
      "npm run build && npm run db:local && npx wrangler dev --config wrangler.local.jsonc --port 5184",
    url: "http://localhost:5184/api/config",
    reuseExistingServer: false,
    timeout: 120000,
  },
});
