import {execFileSync} from 'node:child_process';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {storybookTurboFilters} from '../preview-manifest.js';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const filters = storybookTurboFilters.flatMap((packageName) => ['--filter', packageName]);

for (const task of ['build', 'storybook:build'] as const) {
  execFileSync('pnpm', ['exec', 'turbo', task, '--concurrency=4', ...filters], {
    cwd: repositoryRoot,
    stdio: 'inherit',
  });
}
