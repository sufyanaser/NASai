import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "./",
  build: { outDir: "dist" },
  test: {
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts",
  },
});
