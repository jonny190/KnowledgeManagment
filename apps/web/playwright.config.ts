import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./playwright",
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  retries: 2,
  reporter: "list",
  globalSetup: "./playwright/global-setup.ts",
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
    navigationTimeout: 30_000,
    actionTimeout: 15_000,
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
        AI_PROVIDER: "stub",
        ANTHROPIC_API_KEY: "stub",
      },
    },
    {
      command: "pnpm --filter @km/realtime dev",
      port: 3001,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        DATABASE_URL: process.env.DATABASE_URL ?? "postgres://km:km@localhost:5432/km",
        REALTIME_JWT_SECRET: process.env.REALTIME_JWT_SECRET ?? "e2e-realtime-secret",
      },
    },
  ],
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
