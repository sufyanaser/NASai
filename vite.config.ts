import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "./",
  publicDir: "assets",
  build: { outDir: "dist" },
  test: {
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts",
  },
});
