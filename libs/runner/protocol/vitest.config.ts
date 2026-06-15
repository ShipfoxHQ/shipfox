import {defineConfig, type UserConfigExport} from '@shipfox/vitest';

export default defineConfig(
  {
    test: {
      setupFiles: ['test/env.ts'],
    },
  },
  import.meta.url,
) as UserConfigExport;
