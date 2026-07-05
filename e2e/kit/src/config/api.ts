import {defineConfig} from '@shipfox/playwright';

export function defineApiE2eConfig() {
  return defineConfig({
    testDir: './tests',
    testMatch: '**/*.e2e.ts',
    globalSetup: '@shipfox/e2e-kit/api-global-setup',
    reporter: process.env.CI ? 'github' : 'list',
    use: {
      trace: 'retain-on-failure',
    },
  });
}
