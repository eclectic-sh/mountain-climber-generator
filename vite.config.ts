import { defineConfig } from "vite";

import packageJson from "./package.json" with { type: "json" };

export default defineConfig({
  base: "/mountain-climber-generator/",
  define: {
    __PYODIDE_VERSION__: JSON.stringify(packageJson.devDependencies.pyodide),
  },
  build: {
    target: "es2022",
    sourcemap: false,
  },
  worker: {
    format: "es",
  },
});
