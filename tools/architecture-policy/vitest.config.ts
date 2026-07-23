import {defineConfig, type UserConfigExport} from '@shipfox/vitest';

export default defineConfig(
  {
    test: {
      include: ['test/**/*.test.ts'],
    },
  },
  import.meta.url,
) as UserConfigExport;
