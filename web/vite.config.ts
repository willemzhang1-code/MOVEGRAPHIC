import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  root: 'demo',
  base: './',
  resolve: {
    alias: { '@sinew/runtime': fileURLToPath(new URL('./runtime/src/index.ts', import.meta.url)) },
  },
  build: { outDir: '../dist', emptyOutDir: true, target: 'es2022' },
  server: { host: '127.0.0.1', port: 5173 },
});
