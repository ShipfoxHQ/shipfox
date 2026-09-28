/**
 * Preloaded with `node --import` before the bootstrap. It installs the action module resolution
 * hook, so it must run before any action file is imported.
 */
import {realpathSync} from 'node:fs';
import {registerHooks} from 'node:module';
import {ACTION_ENV} from '#contract.js';
import {createActionResolveHook} from '#module-resolution.js';

const bundleDir = process.env[ACTION_ENV.actionPath];
if (!bundleDir) {
  throw new Error(
    `${ACTION_ENV.actionPath} is not set. The runner sets it to the action directory.`,
  );
}

registerHooks({
  resolve: createActionResolveHook({
    bundleDir: realpathSync(bundleDir),
    workspaceDir: process.cwd(),
    sdkUrl: import.meta.url,
  }),
});
