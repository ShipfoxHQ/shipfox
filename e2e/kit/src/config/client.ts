import {config} from '@shipfox/e2e-core';
import {defineConfig, devices, type PlaywrightTestConfig} from '@shipfox/playwright';

export interface ClientE2eConfigOptions {
  buildName: string;
  timeout?: number;
  use?: PlaywrightTestConfig['use'];
}

export function defineClientE2eConfig(options: ClientE2eConfigOptions) {
  return defineConfig({
    testDir: './tests',
    testMatch: '**/*.e2e.ts',
    globalSetup: './tests/global-setup.ts',
    ...(options.timeout !== undefined ? {timeout: options.timeout} : {}),
    reporter: process.env.CI
      ? [
          ['github'],
          [
            '@argos-ci/playwright/reporter',
            {
              uploadToArgos: Boolean(process.env.ARGOS_TOKEN),
              buildName: options.buildName,
              ignoreUploadFailures: true,
            },
          ],
        ]
      : 'list',
    use: {
      baseURL: config.CLIENT_URL,
      trace: 'retain-on-failure',
      timezoneId: 'UTC',
      contextOptions: {reducedMotion: 'reduce'},
      ...options.use,
    },
    projects: [
      {
        name: 'chromium',
        use: devices['Desktop Chrome'],
      },
    ],
  });
}
