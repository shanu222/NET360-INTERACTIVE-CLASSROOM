import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const api = process.env.API_ORIGIN ?? 'http://localhost:4000';

export default defineConfig({
  plugins: [react()],
  envDir: '../..',
  server: {
    host: true, // reachable from phones on the same Wi-Fi
    port: 5173,
    proxy: {
      '/api': api,
      '/socket.io': { target: api, ws: true },
    },
  },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 900,
  },
});
