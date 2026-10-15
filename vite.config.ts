import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative asset URLs: the build works from any folder or sub-path of a static host (D-147).
  base: './',
  worker: { format: 'es' },
  build: { target: 'es2022', sourcemap: false },
  test: { include: ['tests/**/*.test.ts'] },
});
