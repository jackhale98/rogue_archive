import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'packages/*/test/**/*.test.ts',
      'games/*/tests/**/*.test.ts',
      'apps/web/src/**/*.test.ts',
      'tools/**/*.test.ts',
    ],
    environment: 'node',
  },
});
