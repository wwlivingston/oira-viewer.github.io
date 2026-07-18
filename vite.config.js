import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "./", // works whether hosted at root or a subpath
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
