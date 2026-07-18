import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      devOptions: {
        enabled: true,
      },
      manifest: {
        name: "Trucoviski",
        short_name: "Trucoviski",
        description: "Truco Paulista Online",
        theme_color: "#1a4d2e",
        background_color: "#0d1e11",
        display: "standalone",
        orientation: "any",
        icons: [
          {
            src: "icon-192x192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "icon-512x512.png",
            sizes: "512x512",
            type: "image/png",
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      "@trucoviski/shared": path.resolve(
        __dirname,
        "../../packages/shared/src/index.ts",
      ),
    },
  },
  server: {
    proxy: {
      "/matchmake": {
        target: "http://localhost:2568",
      },
      "/room": {
        target: "ws://localhost:2568",
        ws: true,
      },
    },
  },
});
