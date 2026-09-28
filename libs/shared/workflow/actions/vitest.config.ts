import {defineConfig, type UserConfigExport} from '@shipfox/vitest';

export default defineConfig(
  {
    test: {
      projects: [
        {extends: true, test: {name: 'unit', include: ['src/**/*.test.ts']}},
        // The testing helper must work under both pools, running at the same time.
        {
          extends: true,
          test: {name: 'threads', pool: 'threads', include: ['test/pools/*.test.ts']},
        },
        {extends: true, test: {name: 'forks', pool: 'forks', include: ['test/pools/*.test.ts']}},
      ],
    },
  },
  import.meta.url,
) as UserConfigExport;
