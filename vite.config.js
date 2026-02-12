import { defineConfig } from "vite";

// Bare imports resolved by the browser import map at runtime (not by Vite)
const IMPORT_MAP_EXTERNALS = [
  "react",
  "react/jsx-runtime",
  "react-dom/client",
  "react-refresh/runtime",
  "styled-components",
];

export default defineConfig({
  server: {
    port: 3000,
    proxy: {
      "/api/chat": "http://localhost:3001",
    },
  },
  build: {
    outDir: "dist",
    rollupOptions: {
      external: (id) =>
        id.startsWith("https://") ||
        id.startsWith("http://") ||
        IMPORT_MAP_EXTERNALS.includes(id),
    },
  },
});
