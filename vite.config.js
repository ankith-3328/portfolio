import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 800, // Three.js on its own is ~600 kB before gzip
  },
});
