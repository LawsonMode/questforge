import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',
  build: { target: 'es2022', outDir: 'dist', assetsInlineLimit: 0 },
  server: { port: 5173, strictPort: false },
  test: {
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    environment: 'node',
  },
});
