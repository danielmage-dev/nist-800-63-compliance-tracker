import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // Bind 0.0.0.0 so a sandbox-published port (e.g. acq/sbx `ports --publish`)
    // can reach the dev server from the host. The Express API stays bound to
    // 127.0.0.1 inside the guest; the browser only talks to Vite, which proxies
    // /api to the API server-side within the guest.
    host: true,
    port: 5180,
    proxy: {
      '/api': 'http://localhost:3001',
      '/spec-assets': 'http://localhost:3001',
    },
  },
});
