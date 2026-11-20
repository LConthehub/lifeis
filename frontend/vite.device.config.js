// Builds Life Is as an app that keeps everything on the device: the same pages, with the handlers and the
// database inside (src/device). The usual build (vite.config.js) is untouched by this one.
//   npx vite build --config vite.device.config.js      then      npx vite preview --config vite.device.config.js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: { outDir: 'dist-device', rollupOptions: { input: 'device.html' }, target: 'es2022' },
  optimizeDeps: { exclude: ['@sqlite.org/sqlite-wasm'] },
  // The core and the handlers live beside this folder, not inside it.
  server: { fs: { allow: ['..'] } },
  preview: { port: 4179, strictPort: true },
});
