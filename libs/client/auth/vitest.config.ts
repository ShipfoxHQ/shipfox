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
            exclude: ['src/state/last-workspace.test.ts'],
          },
        },
        {
          extends: true,
          test: {
            name: 'dom',
            environment: 'jsdom',
            include: ['src/**/*.test.tsx', 'src/state/last-workspace.test.ts'],
            setupFiles: ['test/setup.ts'],
          },
        },
      ],
    },
  },
  import.meta.url,
) as UserConfigExport;
