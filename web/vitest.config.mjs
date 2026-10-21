import { defineConfig } from "vitest/config";
import { transformWithEsbuild } from "vite";
export default defineConfig({
  plugins: [{ name: "jsx-in-app-js", enforce: "pre", async transform(code, id) {
    if (/\/app\/.*\.js$/.test(id)) return transformWithEsbuild(code, id, { loader: "jsx", jsx: "automatic" });
  } }],
  esbuild: { jsx: "automatic" },
  test: { environment: "node", include: ["tests/**/*.test.jsx"] }
});
