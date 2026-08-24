import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  use: {
    baseURL: "http://127.0.0.1:32123",
    viewport: { width: 1366, height: 768 },
    screenshot: "only-on-failure",
  },
  webServer: {
    command:
      "powershell.exe -NoProfile -Command \"$env:DATA_DIR='artifacts/e2e-data'; $env:PORT='32123'; pnpm start\"",
    url: "http://127.0.0.1:32123/api/results/union",
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
