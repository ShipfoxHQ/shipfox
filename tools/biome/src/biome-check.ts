#!/usr/bin/env node

import {execSync} from 'node:child_process';
import {buildShellCommand, getProjectBinaryPath, getWorkspaceFilePath} from '@shipfox/tool-utils';

const binPath = getProjectBinaryPath('biome', import.meta.url);
let biomeConfigFile = getWorkspaceFilePath('biome.json');

const extraArgs: string[] = [];
const positionalArgs: string[] = [];

for (let index = 2; index < process.argv.length; index += 1) {
  const argument = process.argv[index];
  if (argument === '--write' || argument === '--fix') {
    extraArgs.push('--write');
  } else if (argument === '--config-path') {
    const configPath = process.argv[index + 1];
    if (!configPath || configPath.startsWith('--'))
      throw new Error('--config-path requires a path to a Biome configuration file');
    biomeConfigFile = configPath;
    index += 1;
  } else if (argument?.startsWith('--config-path=')) {
    biomeConfigFile = argument.slice('--config-path='.length);
  } else if (argument?.startsWith('--')) {
    extraArgs.push(argument);
  } else if (argument) {
    positionalArgs.push(argument);
  }
}

const targets = positionalArgs.length > 0 ? positionalArgs : [process.cwd()];

const command = buildShellCommand([
  binPath,
  'check',
  '--enforce-assist=true',
  '--config-path',
  biomeConfigFile,
  ...extraArgs,
  ...targets,
]);

execSync(command, {stdio: 'inherit'});
