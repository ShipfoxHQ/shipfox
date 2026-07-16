import {defineConfig, type UserConfigExport} from '@shipfox/vitest';

export default defineConfig(
  {
    test: {
      projects: [
        {extends: true, test: {name: 'node', environment: 'node', include: ['src/**/*.test.ts']}},
        {
          extends: true,
          test: {
            name: 'dom',
            environment: 'jsdom',
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
