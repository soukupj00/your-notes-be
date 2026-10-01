import { defineConfig } from 'vitest/config';

// The API and service tests run once per Store; the contract suites run every Store themselves.
export default defineConfig({
  test: {
    projects: [
      { test: { name: 'sqlite', include: ['src/**/*.test.ts'] } },
      {
        test: {
          name: 'pglite',
          include: [
            'src/test/**/*.test.ts',
            'src/server.test.ts',
            'src/modules/**/service.test.ts',
          ],
          exclude: ['src/test/concurrency.test.ts'],
          env: { TEST_STORE: 'pglite' },
          setupFiles: ['src/test/pglite.setup.ts'],
        },
      },
    ],
  },
});
