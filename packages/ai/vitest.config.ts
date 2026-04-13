import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, "../../", "");
  return {
    test: {
      environment: "node",
      include: ["test/**/*.test.ts", "src/**/*.test.ts"],
      testTimeout: 20000,
      pool: "forks",
      poolOptions: { forks: { singleFork: true } },
      env,
    },
  };
});
