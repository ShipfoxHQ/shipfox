import {defineConfig} from '@shipfox/vitest';

export default defineConfig({
  resolve: {conditions: ['default']},
  ssr: {resolve: {conditions: ['default']}},
  test: {
    environment: 'node',
    include: ['test/import.ts'],
  },
});
