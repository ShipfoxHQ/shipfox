import {defineConfig} from '@shipfox/vitest';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/import.ts'],
  },
});
