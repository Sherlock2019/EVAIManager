import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// In development the API runs on :8000; in Docker, nginx proxies /api and /ws.
const backend = process.env.VITE_BACKEND_URL ?? "http://localhost:8000";

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    proxy: {
      "/api": { target: backend, changeOrigin: true },
      "/ws": { target: backend, ws: true, changeOrigin: true },
    },
  },
  // `vite preview` serves the built dashboard for start.sh (native mode) and reuses the proxy above.
  // Any Host header is accepted so it answers on a public IP or an EC2 DNS name.
  preview: { host: true, port: 9063, allowedHosts: true },
  build: { chunkSizeWarningLimit: 1200 },
});
