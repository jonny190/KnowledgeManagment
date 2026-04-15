import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    testTimeout: 30000,
    pool: "forks",
    // One file per fork, run sequentially. yjs mis-detects itself as
    // "already imported" when multiple test files share a process, which
    // breaks the integration test's CRDT convergence.
    fileParallelism: false,
  },
});
