import {config} from '@shipfox/e2e-core';
import {defineConfig, devices} from '@shipfox/playwright';

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.e2e.ts',
  globalSetup: './tests/global-setup.ts',
  reporter: process.env.CI
    ? [
        ['github'],
        [
          '@argos-ci/playwright/reporter',
          {
            uploadToArgos: Boolean(process.env.ARGOS_TOKEN),
            buildName: 'e2e-client-workspaces',
            ignoreUploadFailures: true,
          },
        ],
      ]
    : 'list',
  use: {
    baseURL: config.CLIENT_URL,
    trace: 'retain-on-failure',
    contextOptions: {reducedMotion: 'reduce'},
  },
  projects: [
    {
      name: 'chromium',
      use: devices['Desktop Chrome'],
    },
  ],
});
