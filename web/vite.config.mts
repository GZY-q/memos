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
              test: /node_modules[\\/](react-markdown|unified|micromark|mdast-util|unist-util-visit|remark-|rehype-)/,
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
