import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {
  assertGuidanceManifest,
  type GuidanceManifest,
  guidanceManifestSchemaVersion,
  guidancePackageName,
  guidanceRepository,
  isGuidanceManifest,
} from './manifest.js';

const distRoot = dirname(fileURLToPath(import.meta.url));

export const bundleRoot = resolve(distRoot, 'bundle');
export const manifestPath = resolve(bundleRoot, 'MANIFEST.json');

export type {GuidanceManifest};
export {
  assertGuidanceManifest,
  guidanceManifestSchemaVersion,
  guidancePackageName,
  guidanceRepository,
  isGuidanceManifest,
};

export function getGuidanceBundleRoot(): string {
  return bundleRoot;
}

export function getGuidanceManifestPath(): string {
  return manifestPath;
}

export function readGuidanceManifest(): GuidanceManifest {
  const value: unknown = JSON.parse(readFileSync(manifestPath, 'utf8'));
  assertGuidanceManifest(value);
  return value;
}
