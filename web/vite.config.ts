import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  root: r('.'),
  base: '/',
  publicDir: 'public',
  plugins: [react()],
  resolve: {
    alias: { '@sinew/runtime': r('./runtime/src/index.ts') },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    rollupOptions: {
      input: { index: r('index.html'), studio: r('studio/index.html'), demo: r('demo/index.html') },
    },
  },
  server: { host: '127.0.0.1', port: 5173 },
});
