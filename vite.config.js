import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        velora: fileURLToPath(new URL('./index.html', import.meta.url)),
        appearance: fileURLToPath(new URL('./appearance.html', import.meta.url)),
        pushup: fileURLToPath(new URL('./pushup.html', import.meta.url)),
        elbow: fileURLToPath(new URL('./elbow.html', import.meta.url)),
      },
    },
  },
});
