import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    // The API holds provider keys; the browser only ever talks to it via /api.
    proxy: { '/api': 'http://127.0.0.1:4000' },
  },
  build: { outDir: 'dist', sourcemap: false },
});
