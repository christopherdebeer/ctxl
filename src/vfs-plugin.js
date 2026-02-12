/**
 * esbuild VFS plugin.
 *
 * Resolves imports against the in-memory VFS map and injects
 * React Refresh registration for TSX/JSX files.
 */
import { injectReactRefresh } from "./refresh.js";

export function createVFSPlugin(filesMap, options = {}) {
  const { RefreshRuntime } = options;
  return {
    name: "vfs",
    setup(build) {
      build.onResolve({ filter: /.*/ }, (args) => {
        if (args.kind === "entry-point") {
          return { path: args.path, namespace: "vfs" };
        }
        // Bare imports (react, styled-components, etc.) → external
        if (!args.path.startsWith(".") && !args.path.startsWith("/")) {
          return { path: args.path, external: true };
        }
        const baseDir = args.resolveDir || "/";
        const resolved = new URL(args.path, "file://" + baseDir + "/").pathname;
        const candidates = [
          resolved,
          resolved + ".ts", resolved + ".tsx",
          resolved + ".js", resolved + ".jsx",
          resolved + "/index.ts", resolved + "/index.tsx",
          resolved + "/index.js", resolved + "/index.jsx",
        ];
        const hit = candidates.find((p) => filesMap.has(p));
        if (!hit) {
          throw new Error(`Module not found: ${args.path} (from ${args.importer || "?"})`);
        }
        return { path: hit, namespace: "vfs" };
      });

      build.onLoad({ filter: /.*/, namespace: "vfs" }, (args) => {
        let contents = filesMap.get(args.path);
        if (contents == null) {
          throw new Error(`Missing file: ${args.path}`);
        }
        const loader =
          args.path.endsWith(".tsx") ? "tsx" :
          args.path.endsWith(".ts") ? "ts" :
          args.path.endsWith(".jsx") ? "jsx" : "js";

        if ((loader === "tsx" || loader === "jsx") && RefreshRuntime) {
          contents = injectReactRefresh(contents, args.path);
        }
        const resolveDir = args.path.slice(0, args.path.lastIndexOf("/")) || "/";
        return { contents, loader, resolveDir };
      });
    },
  };
}
