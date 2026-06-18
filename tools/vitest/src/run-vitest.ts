import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname, join} from 'node:path';
import {getProjectBinaryPath} from '@shipfox/tool-utils';

// Resolve the vitest installed in the package under test (process.cwd()), falling back
// to this tool's own copy for packages that don't depend on vitest directly.
//
// Browser-mode suites (e.g. @shipfox/react-ui's Storybook tests) load @vitest/browser
// from their own dependency tree. Running this tool's vitest core against that browser
// package is a cross-install instance mismatch: the browser RPC handshake never
// completes, so the run hangs at startup and silently burns the entire CI job timeout.
function resolveVitestBin(): string {
  try {
    const require = createRequire(join(process.cwd(), 'noop.js'));
    const packageJsonPath = require.resolve('vitest/package.json');
    const {bin} = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
      bin: string | Record<string, string>;
    };
    const entry = typeof bin === 'string' ? bin : bin.vitest;
    if (!entry) throw new Error('vitest package.json declares no bin entry');
    return join(dirname(packageJsonPath), entry);
  } catch {
    return getProjectBinaryPath('vitest', import.meta.url);
  }
}

// Spawn vitest directly (no shell): going through `sh -c` is unnecessary and the binary
// path is resolved here, so there is nothing to quote.
export function runVitest(args: string[]): void {
  execFileSync(resolveVitestBin(), args, {
    stdio: 'inherit',
    env: {
      ...process.env,
      LOG_LEVEL: process.env.LOG_LEVEL ?? 'silent',
      STORYBOOK_DISABLE_TELEMETRY: process.env.STORYBOOK_DISABLE_TELEMETRY ?? 'true',
    },
  });
}
