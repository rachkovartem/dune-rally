import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    target: 'esnext',
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'shared/**/*.test.ts', 'server/**/*.test.ts'],
  },
});
