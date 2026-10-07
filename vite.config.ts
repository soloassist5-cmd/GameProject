import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative base so the build works on itch.io / any static host.
  base: './',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
