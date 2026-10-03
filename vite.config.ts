import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The control room. Built into dist/web and served by the Tempo server from the same origin.
export default defineConfig({
  root: 'src/web',
  plugins: [react()],
  build: {
    outDir: '../../dist/web',
    emptyOutDir: true,
    sourcemap: false,
    target: 'es2022',
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: false },
      '/mcp': 'http://localhost:3000',
      '/a/': 'http://localhost:3000',
      '/openapi.json': 'http://localhost:3000',
      '/agents.md': 'http://localhost:3000',
      '/healthz': 'http://localhost:3000',
    },
  },
});
