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
// A missing value is rejected so a trailing `--image` never silently disables
// tagging, and `--image --push` never swallows the next flag as the name.
function takeImageName(): string | undefined {
  const inline = passthrough.findIndex((arg) => arg.startsWith('--image='));
  if (inline !== -1) {
    const value = passthrough.splice(inline, 1)[0].slice('--image='.length);
    if (!value) throw new Error('--image requires a non-empty value (e.g. --image api).');
    return value;
  }
  const flag = passthrough.indexOf('--image');
  if (flag !== -1) {
    const value = passthrough[flag + 1];
    if (!value || value.startsWith('-'))
      throw new Error('--image requires a value (e.g. --image api).');
    passthrough.splice(flag, 2);
    return value;
  }
  return undefined;
}

// Docker tag refs allow [A-Za-z0-9_.-]; the moving tag is a branch name, so map
// anything else to '-' (a slash in a feature branch would otherwise be rejected).
function sanitizeTag(value: string): string {
  return value.replace(/[^A-Za-z0-9_.-]/g, '-');
}

// Derive the tag set from the environment (IMAGE_REGISTRIES bases plus the
// GITHUB_SHA / BUILD_NUMBER / GITHUB_REF_NAME commit identity) so adding a registry
// is a config change, not a code change. IMAGE_REGISTRIES is a space-separated list
// read by name — not a prefix scan of the environment — so a stray credential
// variable is never mistaken for a registry base and logged. With it unset (the PR
// validation path) emit a single local tag so a --load build has a reference to
// load. See the README for the full tag scheme.
function perCommitTags(image: string): string[] {
  const registries = (process.env.IMAGE_REGISTRIES ?? '').split(/\s+/).filter(Boolean);
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
