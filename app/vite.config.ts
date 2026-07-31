import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// La misma codebase corre como webapp (navegador) y como app de escritorio
// (Electron carga el build). base "./" permite file:// sin servidor.
export default defineConfig({
  plugins: [react()],
  base: "./",
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:3456",
      "/fonts": "http://localhost:3456",
    },
  },
  build: { outDir: "dist", emptyOutDir: true },
});
