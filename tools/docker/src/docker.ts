#! /usr/bin/env node

import {execSync} from 'node:child_process';
import {buildShellCommand, log} from '@shipfox/tool-utils';
import {setupContext} from './turbo.js';

const DEFAULT_PLATFORMS = 'linux/amd64,linux/arm64';

// Everything after the bin name; `--setup-context` is consumed here, the rest is
// forwarded verbatim to `docker buildx build` (tags, build-args, labels, ...).
const passthrough = process.argv.slice(2);

function hasFlag(...flags: string[]): boolean {
  return passthrough.some((arg) =>
    flags.some((flag) => arg === flag || arg.startsWith(`${flag}=`)),
  );
}

function firstTag(): string | undefined {
  const index = passthrough.indexOf('--tag');
  if (index !== -1) return passthrough[index + 1];
  return passthrough.find((arg) => arg.startsWith('--tag='))?.slice('--tag='.length);
}

// Keep each app's gha cache separate so the three images built in one workflow
// run don't clobber each other. The scope is the image name (its last path
// segment), which is stable across registries: e.g. ghcr.io/org/api -> api.
function cacheScope(): string | undefined {
  const image = firstTag()?.split(':')[0] ?? process.env.npm_package_name;
  return image?.split('/').pop();
}

const setupIndex = passthrough.indexOf('--setup-context');
if (setupIndex !== -1) {
  const packageName = process.env.npm_package_name;
  if (!packageName)
    throw new Error(
      '--setup-context needs npm_package_name; run shipfox-docker through a package "image" script.',
    );
  setupContext(packageName);
  passthrough.splice(setupIndex, 1);
}

const args: string[] = [];

// Drop provenance attestations so the pushed manifest stays a clean per-arch
// index without the "unknown/unknown" entries some registries show otherwise.
if (!hasFlag('--provenance')) args.push('--provenance=false');

// A single buildx build emits the multi-arch manifest itself; QEMU covers both
// arches in one pass, so there is no per-arch matrix or `docker manifest` step.
if (!hasFlag('--platform')) args.push('--platform', DEFAULT_PLATFORMS);

// A multi-platform build cannot `--load`, so default to pushing. The PR path
// opts out by passing its own `--load`/`--output` (single-arch, validate only).
if (!hasFlag('--push', '--load', '--output', '-o')) args.push('--push');

if (process.env.GITHUB_ACTIONS) {
  const scope = cacheScope();
  const scoped = scope ? [`scope=${scope}`] : [];
  args.push('--cache-from', ['type=gha', ...scoped].join(','));
  args.push('--cache-to', ['type=gha', 'mode=max', 'ignore-error=true', ...scoped].join(','));
}

if (process.env.NODE_VERSION) args.push(`--build-arg=NODE_VERSION=${process.env.NODE_VERSION}`);
if (process.env.PNPM_VERSION) args.push(`--build-arg=PNPM_VERSION=${process.env.PNPM_VERSION}`);

const command = buildShellCommand(['docker', 'buildx', 'build', ...args, ...passthrough, '.']);
log.info(command);
execSync(command, {stdio: 'inherit'});
