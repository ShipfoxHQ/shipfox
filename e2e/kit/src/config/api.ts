import {defineConfig, type PlaywrightTestConfig} from '@shipfox/playwright';

export interface ApiE2eConfigOptions {
  globalSetup: NonNullable<PlaywrightTestConfig['globalSetup']>;
  globalTeardown?: PlaywrightTestConfig['globalTeardown'];
}

export function defineApiE2eConfig(options: ApiE2eConfigOptions) {
  return defineConfig({
    testDir: './tests',
    testMatch: '**/*.e2e.ts',
    globalSetup: options.globalSetup,
    ...(options.globalTeardown === undefined ? {} : {globalTeardown: options.globalTeardown}),
    reporter: process.env.CI ? 'github' : 'list',
    use: {
      trace: 'retain-on-failure',
    },
  });
}
