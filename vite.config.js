import { defineConfig } from "vite";

export default defineConfig({
  server: {
    host: process.env.FRONTEND_HOST || "0.0.0.0",
    port: Number(process.env.FRONTEND_PORT || 3102),
    strictPort: true,
    watch: {
      ignored: ["**/data/**", "**/logs/**"]
    },
    proxy: {
      "/api": process.env.VITE_API_BASE_URL || `http://127.0.0.1:${process.env.BACKEND_PORT || 8102}`
    }
  },
  build: {
    outDir: "dist"
  }
});
