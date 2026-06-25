#! /usr/bin/env node

import {execSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {buildShellCommand, getProjectBinaryPath, getProjectFilePath} from '@shipfox/tool-utils';
import {assertTestFilesIncluded} from './test-file-coverage.js';

const testConfigPath = getProjectFilePath('tsconfig.test.json');
let configPath = testConfigPath;
if (!existsSync(configPath)) configPath = getProjectFilePath('tsconfig.json');

if (configPath === testConfigPath) {
  try {
    assertTestFilesIncluded(configPath);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

const binPath = getProjectBinaryPath('tsc', import.meta.url);

const command = buildShellCommand([binPath, '--project', configPath, '--noEmit']);
execSync(command, {
  stdio: 'inherit',
});
