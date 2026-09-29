import {REGISTRY_DIGEST_PATTERN} from '#documents.js';
import {isRegistrySlug, isRegistryVersion, parseRegistryPackageName} from '#reference.js';

// Every helper validates its segments, so a crafted name can never reach another route.

export const REGISTRY_METADATA_PATH = '/.well-known/shipfox-registry.json';
/** The catalog: `GET` with `kind`, `q`, and `cursor` query parameters. */
export const REGISTRY_CATALOG_PATH = '/v1/packages';

export function registryNamespacePath(namespace: string): string {
  if (!isRegistrySlug(namespace)) {
    throw new TypeError(`${JSON.stringify(namespace)} is not a namespace`);
  }
  return `/v1/namespaces/${namespace}`;
}

/** The package index: its kind and every version. */
export function registryPackagePath(packageName: string): string {
  const {namespace, name} = assertPackageName(packageName);
  return `${REGISTRY_CATALOG_PATH}/${namespace}/${name}`;
}

/** The signed envelope of a version. */
export function registryVersionPath(params: {package: string; version: string}): string {
  return `${registryPackagePath(params.package)}/versions/${assertVersion(params.version)}`;
}

export function registryReadmePath(params: {package: string; version: string}): string {
  return `${registryVersionPath(params)}/readme`;
}

/** Redirects to a short-lived download URL of the content bundle. */
export function registryContentPath(params: {package: string; version: string}): string {
  return `${registryVersionPath(params)}/content`;
}

/** Redirects to a short-lived download URL of the source archive. */
export function registrySourcePath(params: {package: string; version: string}): string {
  return `${registryVersionPath(params)}/source`;
}

/**
 * Key of a content bundle or source archive in the private blob store. It is
 * never a public path: readers reach blobs through the download routes.
 */
export function registryBlobKey(digest: string): string {
  if (!REGISTRY_DIGEST_PATTERN.test(digest)) {
    throw new TypeError(`${JSON.stringify(digest)} is not a sha256 digest`);
  }
  return `blobs/sha256/${digest.slice('sha256:'.length)}`;
}

function assertPackageName(packageName: string) {
  const parsed = parseRegistryPackageName(packageName);
  if (!parsed) throw new TypeError(`${JSON.stringify(packageName)} is not a package name`);
  return parsed;
}

function assertVersion(version: string): string {
  if (!isRegistryVersion(version)) {
    throw new TypeError(`${JSON.stringify(version)} is not an exact registry version`);
  }
  return version;
}
