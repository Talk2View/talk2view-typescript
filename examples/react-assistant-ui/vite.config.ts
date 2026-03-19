import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import path from 'path';

export default defineConfig({
  plugins: [react(), tailwindcss(), ...(process.env.E2E ? [] : [basicSsl()])],
  server: {
    port: 5174,
    fs: {
      allow: [
        path.resolve(__dirname),
        path.resolve(__dirname, '../../packages/sdk'),
      ],
    },
    proxy: {
      '/v1': {
        target: 'http://localhost:8100',
        changeOrigin: true,
      },
    },
  },
});
