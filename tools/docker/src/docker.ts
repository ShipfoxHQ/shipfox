#! /usr/bin/env node

import {execSync} from 'node:child_process';
import {buildShellCommand, log} from '@shipfox/tool-utils';
import {setupContext} from './turbo.js';

const DEFAULT_PLATFORMS = 'linux/amd64,linux/arm64';

// Matches the :tag / @digest suffix of an image reference's final path segment.
const TAG_OR_DIGEST_SUFFIX = /[:@].*$/;

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
  const reference = firstTag() ?? process.env.npm_package_name;
  // Take the final path segment first, then drop the :tag / @digest suffix, so a
  // registry port (host:port/...) is never mistaken for the tag separator.
  return reference?.split('/').pop()?.replace(TAG_OR_DIGEST_SUFFIX, '');
}

// `--image <name>` (e.g. api) names the registry image for the derived tag set. It
// is consumed here, not forwarded, since it is not a `docker buildx build` flag.
function takeImageName(): string | undefined {
  const inline = passthrough.findIndex((arg) => arg.startsWith('--image='));
  if (inline !== -1) return passthrough.splice(inline, 1)[0]?.slice('--image='.length);
  const flag = passthrough.indexOf('--image');
  if (flag !== -1) return passthrough.splice(flag, 2)[1];
  return undefined;
}

// Docker tag refs allow [A-Za-z0-9_.-]; the moving tag is a branch name, so map
// anything else to '-' (a slash in a feature branch would otherwise be rejected).
function sanitizeTag(value: string): string {
  return value.replace(/[^A-Za-z0-9_.-]/g, '-');
}

// The per-commit tag set this build pushes for an app. The workflow supplies the
// ref through the environment — registry bases as REGISTRY_* (e.g.
// REGISTRY_GHCR=ghcr.io/shipfoxhq) and the commit identity as GITHUB_SHA /
// BUILD_NUMBER / GITHUB_REF_NAME — and the package script passes the image name,
// so one `turbo image --filter ...` tags every app. Adding a registry is an env
// change, not a code change. With no REGISTRY_* set (the PR validation path) emit
// a single local tag so a --load build has a reference to load.
function perCommitTags(image: string): string[] {
  const registries = Object.keys(process.env)
    .filter((key) => key.startsWith('REGISTRY_'))
    .map((key) => process.env[key])
    .filter((value): value is string => Boolean(value));
  if (registries.length === 0) return [`${image}:ci`];

  const suffixes: string[] = [];
  const shortSha = process.env.GITHUB_SHA?.slice(0, 7);
  if (shortSha) suffixes.push(`sha-${shortSha}`);
  if (process.env.BUILD_NUMBER) suffixes.push(`build-${process.env.BUILD_NUMBER}`);
  if (process.env.GITHUB_REF_NAME) suffixes.push(sanitizeTag(process.env.GITHUB_REF_NAME));
  if (suffixes.length === 0)
    throw new Error(
      'shipfox-docker --image needs GITHUB_SHA, BUILD_NUMBER, or GITHUB_REF_NAME set to derive a tag.',
    );

  return registries.flatMap((registry) =>
    suffixes.map((suffix) => `${registry}/${image}:${suffix}`),
  );
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

const imageName = takeImageName();

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

// Tags: an explicit --tag wins; otherwise derive the per-commit set from --image.
if (imageName && !hasFlag('--tag', '-t')) {
  for (const tag of perCommitTags(imageName)) args.push('--tag', tag);
}

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
