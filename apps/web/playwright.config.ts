import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./playwright",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  globalSetup: "./playwright/global-setup.ts",
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "pnpm dev",
      url: "http://localhost:3000",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        REALTIME_JWT_SECRET: process.env.REALTIME_JWT_SECRET ?? "e2e-realtime-secret",
        NEXT_PUBLIC_REALTIME_URL: process.env.NEXT_PUBLIC_REALTIME_URL ?? "ws://localhost:3001",
      },
    },
    {
      command: "pnpm --filter @km/realtime dev",
      port: 3001,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        REALTIME_JWT_SECRET: process.env.REALTIME_JWT_SECRET ?? "e2e-realtime-secret",
      },
    },
  ],
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
