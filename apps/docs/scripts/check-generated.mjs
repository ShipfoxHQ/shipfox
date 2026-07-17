import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const docsRoot = fileURLToPath(new URL('..', import.meta.url));
const repositoryRoot = path.join(docsRoot, '..', '..');
const page = 'apps/docs/content/docs/reference/workflow-schema.mdx';

try {
  execFileSync('git', ['-C', repositoryRoot, 'diff', '--exit-code', '--', page], {
    stdio: 'inherit',
  });
} catch {
  process.stderr.write(`Run pnpm generate and commit the updated ${page} block.\n`);
  process.exitCode = 1;
}
