import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
const backend = process.env.AXIS_DEV_API_TARGET ?? "http://127.0.0.1:8765";
const match = /^http:\/\/127\.0\.0\.1:([1-9]\d{0,4})$/.exec(backend);
if (!match || Number(match[1]) > 65535 || Number(match[1]) === 5173) throw new Error("AXIS_DEV_API_TARGET must be an explicit loopback backend port");
export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: { "/api": { target: backend, changeOrigin: false } },
  },
  build: { sourcemap: false },
  test: {
    environment: "jsdom",
    include: ["tests/**/*.test.{ts,tsx}"],
    setupFiles: ["./tests/setup.ts"],
    restoreMocks: true,
  },
});
