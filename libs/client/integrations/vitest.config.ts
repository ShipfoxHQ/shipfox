import {defineConfig, type UserConfigExport} from '@shipfox/vitest';

export default defineConfig(
  {
    test: {
      environment: 'node',
    },
  },
  import.meta.url,
) as UserConfigExport;
