import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative asset paths so the built app works from any folder (or GitHub Pages).
  base: './',
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
