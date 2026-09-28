import {REGISTRY_DIGEST_PATTERN} from '#documents.js';
import {isRegistrySlug, isRegistryVersion, parseRegistryPackageName} from '#reference.js';

export const REGISTRY_PUBLIC_PREFIXES = ['v1/', '.well-known/'] as const;
/** Never served: audit records and consumed OIDC token ids. */
export const REGISTRY_PRIVATE_PREFIX = '_registry/';

export const REGISTRY_METADATA_PATH = '.well-known/shipfox-registry.json';
export const REGISTRY_CATALOG_PATH = 'v1/index.json';
const TOKEN_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

// Every helper validates its segments, so a crafted name can never escape its prefix.

export function registryNamespacePath(namespace: string): string {
  return `v1/namespaces/${assertNamespace(namespace)}.json`;
}

export function registryPackageIndexPath(packageName: string): string {
  return `${packagePrefix(packageName)}/index.json`;
}

export function registryVersionPath({
  package: packageName,
  version,
}: {
  package: string;
  version: string;
}): string {
  return `${packagePrefix(packageName)}/versions/${assertVersion(version)}.json`;
}

/** Content bundles, source archives, and READMEs, addressed by `sha256:<hex>` digest. */
export function registryBlobPath(digest: string): string {
  if (!REGISTRY_DIGEST_PATTERN.test(digest)) {
    throw new TypeError(`${JSON.stringify(digest)} is not a sha256 digest`);
  }
  return `v1/blobs/sha256/${digest.slice('sha256:'.length)}`;
}

/** One record per publish attempt, accepted or refused, grouped by UTC day. */
export function registryAuditPath({
  at,
  package: packageName,
  version,
}: {
  at: Date;
  package: string;
  version: string;
}): string {
  const {namespace, name} = assertPackageName(packageName);
  const timestamp = at.toISOString().replaceAll(':', '');
  const day = timestamp.slice(0, 'yyyy-mm-dd'.length);
  return `${REGISTRY_PRIVATE_PREFIX}audit/${day}/${timestamp}-${namespace}-${name}-${assertVersion(version)}.json`;
}

export function registryJtiPath(jti: string): string {
  if (!TOKEN_ID_PATTERN.test(jti)) throw new TypeError(`${JSON.stringify(jti)} is not a token id`);
  return `${REGISTRY_PRIVATE_PREFIX}jti/${jti}`;
}

function packagePrefix(packageName: string): string {
  const {namespace, name} = assertPackageName(packageName);
  return `v1/packages/${namespace}/${name}`;
}

function assertPackageName(packageName: string) {
  const parsed = parseRegistryPackageName(packageName);
  if (!parsed) throw new TypeError(`${JSON.stringify(packageName)} is not a package name`);
  return parsed;
}

function assertNamespace(namespace: string): string {
  if (!isRegistrySlug(namespace)) {
    throw new TypeError(`${JSON.stringify(namespace)} is not a namespace`);
  }
  return namespace;
}

function assertVersion(version: string): string {
  if (!isRegistryVersion(version)) {
    throw new TypeError(`${JSON.stringify(version)} is not an exact registry version`);
  }
  return version;
}
