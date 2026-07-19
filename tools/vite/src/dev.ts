import {execSync} from 'node:child_process';
import {readFileSync, realpathSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname, join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {buildShellCommand} from '@shipfox/tool-utils';

const require = createRequire(pathToFileURL(realpathSync(fileURLToPath(import.meta.url))));
const tsxLoader = pathToFileURL(require.resolve('tsx')).href;
const viteManifestPath = require.resolve('vite/package.json');
const viteManifest = JSON.parse(readFileSync(viteManifestPath, 'utf8')) as {
  bin?: string | Record<string, string>;
};
const viteBin = typeof viteManifest.bin === 'string' ? viteManifest.bin : viteManifest.bin?.vite;
if (!viteBin) throw new Error('vite package.json declares no vite binary');
const viteBinPath = join(dirname(viteManifestPath), viteBin);

const command = buildShellCommand([
  process.execPath,
  '--conditions=workspace-source',
  `--import=${tsxLoader}`,
  viteBinPath,
  '--configLoader',
  'native',
]);
execSync(command, {stdio: 'inherit'});
