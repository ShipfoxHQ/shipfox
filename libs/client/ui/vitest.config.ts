import {defineConfig, type UserConfigExport} from '@shipfox/vitest';

export default defineConfig(
  {
    test: {
      projects: [
        {
          extends: true,
          test: {
            name: 'node',
            environment: 'node',
            include: ['src/**/*.test.ts'],
          },
        },
        {
          extends: true,
          test: {
            name: 'dom',
            environment: 'jsdom',
            // Files are isolation-safe (test/setup.ts resets DOM + api client), so reuse the
            // module graph across files in a worker instead of re-importing it per file.
            isolate: false,
            include: ['src/**/*.test.tsx'],
            setupFiles: ['test/setup.ts'],
          },
        },
      ],
    },
  },
  import.meta.url,
) as UserConfigExport;
