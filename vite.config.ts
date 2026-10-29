import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  root: 'web',
  publicDir: 'public',
  base: './',
  server: {
    port: 5173,
    strictPort: false,
    fs: { allow: [resolve(__dirname)] },
    // Cross-origin isolation gives high-resolution performance.now() for benchmarks.
    headers: { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' },
  },
  preview: {
    port: 4173,
    headers: { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' },
  },
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
    target: 'es2022',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'web/index.html'),
        conformance: resolve(__dirname, 'web/conformance.html'),
      },
    },
  },
});
