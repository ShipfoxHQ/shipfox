import {defineConfig, type UserConfigExport} from '@shipfox/vitest';

export default defineConfig(
  {
    test: {
      environment: 'jsdom',
      include: ['src/**/*.test.ts'],
    },
  },
  import.meta.url,
) as UserConfigExport;
