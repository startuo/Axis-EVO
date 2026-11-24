import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const backend = process.env.AXIS_DEV_API_TARGET ?? 'http://127.0.0.1:8765';
const port = /^http:\/\/127\.0\.0\.1:([1-9]\d{0,4})$/.exec(backend);
if (!port || Number(port[1]) > 65535 || Number(port[1]) === 5173) {
  throw new Error('AXIS_DEV_API_TARGET must identify a separate loopback backend');
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@axis/protocol': fileURLToPath(new URL('./src/protocol/index.ts', import.meta.url)) },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: backend, changeOrigin: false },
    },
  },
  build: { manifest: true, sourcemap: false, chunkSizeWarningLimit: 900 },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['tests/m7/**/*.test.{ts,tsx}'],
    setupFiles: ['./tests/m7/setup.ts'],
  },
});
