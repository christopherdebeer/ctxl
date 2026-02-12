import { defineConfig } from "vite";

// Bare imports resolved by the browser import map at runtime (not by Vite)
// Note: react-refresh/runtime is bundled separately, not external
const IMPORT_MAP_EXTERNALS = [
  "react",
  "react/jsx-runtime",
  "react-dom/client",
  "styled-components",
];

export default defineConfig({
  server: {
    port: 3000,
    proxy: {
      "/api/chat": "http://localhost:3001",
    },
  },
  optimizeDeps: {
    // Exclude packages that are loaded via import map at runtime
    exclude: IMPORT_MAP_EXTERNALS,
  },
  define: {
    // Force development mode for react-refresh
    'process.env.NODE_ENV': JSON.stringify('development'),
  },
  build: {
    outDir: "dist",
    rollupOptions: {
      input: {
        main: "index.html",
        "vendor-react-refresh": "src/vendor/react-refresh-runtime.ts",
      },
      output: {
        entryFileNames: (chunkInfo) => {
          // Keep vendor files with predictable names
          if (chunkInfo.name === "vendor-react-refresh") {
            return "vendor/[name].js";
          }
          return "assets/[name]-[hash].js";
        },
      },
      external: (id: string) =>
        id.startsWith("https://") ||
        id.startsWith("http://") ||
        IMPORT_MAP_EXTERNALS.includes(id),
    },
  },
});
