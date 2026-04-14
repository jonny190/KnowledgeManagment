import { defineConfig } from "tsup";
export default defineConfig({
  entry: { wordcount: "src/index.ts" },
  format: ["esm"],
  dts: false,
  clean: false,
  outDir: "../../../apps/web/public/plugins",
  external: ["@km/shared"],
  noExternal: [],
});
