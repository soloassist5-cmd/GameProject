import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

const page = (p: string) => resolve(import.meta.dirname, p);

export default defineConfig({
  // Relative base so the build works on itch.io / any static host.
  base: './',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      input: {
        landing: page('index.html'),
        play: page('play/index.html'),
        trailer: page('trailer/index.html'),
      },
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
