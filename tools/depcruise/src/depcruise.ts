#!/usr/bin/env node

import {execSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {buildShellCommand, getProjectBinaryPath, getWorkspaceFilePath} from '@shipfox/tool-utils';

const binPath = getProjectBinaryPath('depcruise', import.meta.url);
const configFile = getWorkspaceFilePath('.dependency-cruiser.cjs');
const packageJson = JSON.parse(readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')) as {
  name?: string;
};

const command = buildShellCommand([
  binPath,
  '--config',
  configFile,
  '--ts-config',
  'tsconfig.json',
  process.cwd(),
]);

execSync(command, {
  stdio: 'inherit',
  env: {
    ...process.env,
    SHIPFOX_DEPCRUISE_PACKAGE_NAME: packageJson.name ?? '',
  },
});
