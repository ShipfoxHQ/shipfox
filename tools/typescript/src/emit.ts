#! /usr/bin/env node

import {execSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {buildShellCommand, getProjectFilePath, log} from '@shipfox/tool-utils';
import {cleanup} from './utils.js';

export function buildTscEmitCommand(input: {
  binPath: string;
  configFile: string;
  outDir: string;
}): string {
  return buildShellCommand([
    input.binPath,
    '--project',
    input.configFile,
    '--noCheck',
    '--declaration',
    '--emitDeclarationOnly',
    '--outDir',
    input.outDir,
  ]);
}

export async function run() {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  let configFile = join(process.cwd(), 'tsconfig.build.json');
  if (!existsSync(configFile)) configFile = join(process.cwd(), 'tsconfig.json');

  const outDir = getProjectFilePath('dist');

  const binPath = join(__dirname, '..', 'node_modules', '.bin', 'tsc');

  const command = buildTscEmitCommand({
    binPath,
    configFile,
    outDir,
  });
  execSync(command, {stdio: 'inherit'});
  await cleanup(configFile);
}

export function runCli(): void {
  run().catch((e) => {
    log.error(e);
    process.exit(1);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli();
}
