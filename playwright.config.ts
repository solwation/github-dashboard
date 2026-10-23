import { defineConfig } from "@playwright/test";
import { devOrigin, previewOrigin } from "./e2e/ports";

// Each checkout uses its own ports (E2E_DEV_PORT/E2E_PREVIEW_PORT) and never reuses another
// checkout's server unless E2E_REUSE_SERVER=1 (#289).
const devPort = new URL(devOrigin).port, previewPort = new URL(previewOrigin).port;
const reuseExistingServer = process.env.E2E_REUSE_SERVER === "1";
export default defineConfig({
  testDir: "./e2e",
  workers: 3,
  timeout: 60000,
  expect: { timeout: 15000 },
  use: {
    baseURL: devOrigin,
    browserName: "chromium",
    locale: "sv-SE",
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
      : {},
  },
  webServer: [
    {
      command: `npm run dev -- --host 127.0.0.1 --port ${devPort} --strictPort --base /`,
      url: devOrigin,
      reuseExistingServer,
    },
    {
      command: `npm run preview -- --host 127.0.0.1 --port ${previewPort} --strictPort --base /github-dashboard/`,
      url: previewOrigin,
      reuseExistingServer,
    },
  ],
  reporter: "list",
});
