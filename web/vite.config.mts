import babel from "@rolldown/plugin-babel";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { resolve } from "path";
import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";

let devProxyServer = "http://localhost:8081";
if (process.env.DEV_PROXY_SERVER && process.env.DEV_PROXY_SERVER.length > 0) {
  console.log("Use devProxyServer from environment: ", process.env.DEV_PROXY_SERVER);
  devProxyServer = process.env.DEV_PROXY_SERVER;
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), babel({ presets: [reactCompilerPreset()] }), tailwindcss()],
  server: {
    host: "0.0.0.0",
    port: 3001,
    proxy: {
      "^/api/v1/sse": {
        target: devProxyServer,
        xfwd: true,
        // SSE requires no response buffering and longer timeout.
        timeout: 0,
      },
      "^/api": {
        target: devProxyServer,
        xfwd: true,
      },
      "^/memos.api.v1": {
        target: devProxyServer,
        xfwd: true,
      },
      "^/file": {
        target: devProxyServer,
        xfwd: true,
      },
    },
  },
  resolve: {
    alias: {
      "@/": `${resolve(__dirname, "src")}/`,
    },
  },
  build: {
    modulePreload: {
      resolveDependencies: (_filename, deps, { hostType }) => {
        // Rolldown lists statically-analyzable dynamic-import dependencies in the
        // HTML preload list. Heavy vendor chunks that are only consumed lazily
        // (CodeMirror editor, KaTeX math) must not be preloaded with the shell —
        // they are fetched on demand when their dynamic importer actually runs.
        if (hostType === "html") {
          return deps.filter((dep) => !/(?:editor-vendor|math-vendor|leaflet-vendor)-[\w-]+\.js$/.test(dep));
        }
        return deps;
      },
    },
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: "utils-vendor",
              test: /node_modules[\\/](dayjs|lodash-es)([\\/]|$)/,
            },
            {
              name: "leaflet-vendor",
              test: /node_modules[\\/]leaflet([\\/]|$)/,
            },
            {
              // Math stack is only used by the lazily-loaded MathMarkdownRenderer.
              // It must stay out of markdown-vendor (the group below would otherwise
              // capture rehype-katex and drag all of KaTeX into the initial bundle).
              name: "math-vendor",
              test: /node_modules[\\/](katex|rehype-katex|remark-math|mdast-util-math|micromark-extension-math)([\\/]|$)/,
            },
            {
              // Stable vendor chunks: app-code deploys keep the same content hash
              // so browsers can reuse the cached React/markdown libraries.
              name: "react-vendor",
              test: /node_modules[\\/](react-dom|react-router-dom|react-router|react|scheduler)([\\/]|$)/,
            },
            {
              name: "query-vendor",
              test: /node_modules[\\/]@tanstack[\\/](react-query|query-core)([\\/]|$)/,
            },
            {
              name: "markdown-vendor",
              // Negative lookahead keeps the math-only packages in math-vendor even
              // if group precedence changes.
              test: /node_modules[\\/](?!(?:katex|rehype-katex|remark-math|mdast-util-math|micromark-extension-math)[\\/])(?:react-markdown|unified|micromark|mdast-util|unist-util-visit|remark-|rehype-)/,
            },
            {
              name: "editor-vendor",
              test: /node_modules[\\/](@codemirror|@lezer)([\\/]|$)/,
            },
          ],
        },
      },
    },
  },
});
