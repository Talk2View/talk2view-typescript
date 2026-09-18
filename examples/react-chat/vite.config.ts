import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

/**
 * No Tailwind plugin, no PostCSS config, no `components.json`. That is the
 * point of this example: `@talk2view/sdk/chat` brings its own stylesheet, and a
 * partner's build needs to know nothing about it.
 */
export default defineConfig({
  server: {
    fs: {
      // The SDK is installed by `file:`, so Vite has to be allowed to read it.
      allow: [path.resolve(__dirname), path.resolve(__dirname, '../..')],
    },
    proxy: {
      // Only used without `?mock=1`; point it at a real engine to try the
      // example against your own partner key.
      '/api': {
        target: process.env.T2V_ENGINE ?? 'http://localhost:8100',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ''),
      },
    },
  },
  plugins: [react()],
});
