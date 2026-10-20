import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const API = 'http://127.0.0.1:4317';
// O servidor só aceita Host/Origin localhost:4317; o proxy reescreve ambos.
const proxy = { target: API, changeOrigin: true, headers: { origin: 'http://localhost:4317' } };

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react()],
  resolve: { alias: { '@shared': fileURLToPath(new URL('../server/types.ts', import.meta.url)) } },
  build: { outDir: '../dist/web', emptyOutDir: true },
  server: {
    port: 5173,
    // Dev: rode `npm run dev:server` e `npm run dev`; abra http://localhost:5173. O cookie portal_key
    // vale por host (não por porta): visite antes http://localhost:4317/?key=<token> uma vez.
    proxy: { '/api': proxy, '/ws': { ...proxy, ws: true } },
  },
});
