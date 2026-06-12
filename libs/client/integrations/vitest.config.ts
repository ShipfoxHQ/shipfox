import {defineConfig, type UserConfigExport} from '@shipfox/vitest';

export default defineConfig(
  {
    test: {
      environment: 'node',
      setupFiles: ['test/setup.ts'],
    },
  },
  import.meta.url,
) as UserConfigExport;
