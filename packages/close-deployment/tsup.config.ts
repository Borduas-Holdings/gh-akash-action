import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["cjs"],
  target: "node24",
  platform: "node",
  outDir: "dist",
  clean: true,
  sourcemap: false,
  noExternal: [/.*/],
  treeshake: true,
  minify: false,
  bundle: true,
  // Inject crypto polyfill at the top of the bundle
  banner: {
    js: `const { webcrypto } = require("crypto"); if (typeof globalThis.crypto === "undefined") { globalThis.crypto = webcrypto; }`,
  },
});
