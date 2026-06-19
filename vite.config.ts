import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    target: 'esnext',
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
