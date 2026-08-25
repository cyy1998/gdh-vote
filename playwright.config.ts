import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  use: {
    baseURL: "http://127.0.0.1:32123/gdh-vote/",
    httpCredentials: {
      username: "shrq",
      password: "e2e-access-password",
    },
    viewport: { width: 1366, height: 768 },
    screenshot: "only-on-failure",
  },
  webServer: {
    command:
      "powershell.exe -NoProfile -Command \"$env:DATA_DIR='artifacts/e2e-data'; $env:PORT='32123'; $env:TALLY_BASE_PATH='/gdh-vote/'; $env:ACCESS_PASSWORD='e2e-access-password'; $env:ADMIN_PASSWORD_HASH='e2e-admin-salt:d1c006ad6f4307de47b216aaa38f68a1cd38a7ed50e0011735f5704732c39bb3'; pnpm start\"",
    url: "http://127.0.0.1:32123/gdh-vote/api/results/union",
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
