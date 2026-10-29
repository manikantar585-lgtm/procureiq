import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Built assets are served by the CAP server at /ui (see srv/server.js)
export default defineConfig({
  base: '/ui/',
  plugins: [react()],
  build: { outDir: '../app/ui', emptyOutDir: true, chunkSizeWarningLimit: 3000 },
  server: {
    port: 5173,
    proxy: {
      '/odata': 'http://localhost:4004',
      '/samples': 'http://localhost:4004'
    }
  }
});
