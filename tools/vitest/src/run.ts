#! /usr/bin/env node

import {execSync} from 'node:child_process';
import {buildShellCommand, getProjectBinaryPath} from '@shipfox/tool-utils';

const binPath = getProjectBinaryPath('vitest', import.meta.url);

const command = buildShellCommand([binPath, 'run']);
execSync(command, {
  stdio: 'inherit',
  env: {
    ...process.env,
    LOG_LEVEL: process.env.LOG_LEVEL ?? 'silent',
    STORYBOOK_DISABLE_TELEMETRY: process.env.STORYBOOK_DISABLE_TELEMETRY ?? 'true',
  },
});
