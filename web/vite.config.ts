import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
      "/sanity-cdn": {
        target: "https://cdn.sanity.io",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/sanity-cdn/, ""),
      },
    },
  },
});
