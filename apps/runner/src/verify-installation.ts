import {constants} from 'node:fs';
import {access, readdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {assertBundledClaudeCodeVersion} from '@shipfox/runner-agent/claude-code';
import {assertPiHarnessExtensionsAvailable} from '@shipfox/runner-agent/pi-extensions';
import {assertPiImageRasterizerAvailable} from '@shipfox/runner-agent/pi-image-rasterizer';

const require = createRequire(import.meta.url);
// pnpm names each installed copy `@shipfox+<name>@<version or file path>[_<peer suffix>]`.
const SHIPFOX_STORE_ENTRY = /^@shipfox\+([^@]+)@/;
const RUNNER_RUNTIME_EXPORTS = [
  '@shipfox/runner-agent/pi-image-rasterizer',
  '@shipfox/runner-agent/tool-capabilities',
  '@shipfox/runner-agent/step',
  '@shipfox/runner-agent/claude-auth-helper',
  '@shipfox/runner-execution/git-credential-helper',
  './git-credential-helper.js',
] as const;

for (const specifier of RUNNER_RUNTIME_EXPORTS) {
  try {
    require.resolve(specifier);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to resolve runner runtime export "${specifier}": ${reason}`);
  }
}

const claudeAuthHelperPath = require.resolve('@shipfox/runner-agent/claude-auth-helper');
const runnerAgentRequire = createRequire(claudeAuthHelperPath);
try {
  runnerAgentRequire.resolve('@shipfox/runner-workspace/credential-socket-transport');
} catch (error) {
  const reason = error instanceof Error ? error.message : String(error);
  throw new Error(
    `Unable to resolve runner runtime export "@shipfox/runner-workspace/credential-socket-transport": ${reason}`,
  );
}

try {
  await access(claudeAuthHelperPath, constants.X_OK);
} catch (error) {
  const reason = error instanceof Error ? error.message : String(error);
  throw new Error(
    `Claude credential helper is not executable at "${claudeAuthHelperPath}": ${reason}`,
  );
}

// `pnpm deploy` resolves workspace packages and their peers again, so it can install a package
// twice even when the lockfile has one copy. A second copy has its own classes and module state,
// and `instanceof` fails across copies.
const pnpmStoreDir = fileURLToPath(new URL('../node_modules/.pnpm', import.meta.url));
const copiesByPackage = new Map<string, string[]>();
for (const entry of await readdir(pnpmStoreDir)) {
  const match = SHIPFOX_STORE_ENTRY.exec(entry);
  if (!match?.[1]) continue;
  copiesByPackage.set(match[1], [...(copiesByPackage.get(match[1]) ?? []), entry]);
}
const duplicates = [...copiesByPackage].filter(([, entries]) => entries.length > 1);
if (duplicates.length > 0) {
  throw new Error(
    `These packages are installed more than once: ${duplicates
      .map(([name, entries]) => `@shipfox/${name} (${entries.join(', ')})`)
      .join('; ')}`,
  );
}

// Runs during the container and AMI image builds, against the deployed production closure rather
// than the pnpm development tree. Imports the leaf module, not a package barrel: the runner barrels
// validate the runtime environment at module load, which no image build can satisfy. A throw prints
// the offending package and exits nonzero, which is the whole contract here.
assertBundledClaudeCodeVersion();
assertPiHarnessExtensionsAvailable();
await assertPiImageRasterizerAvailable();
