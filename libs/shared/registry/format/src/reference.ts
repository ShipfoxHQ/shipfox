import {z} from 'zod';

export const REGISTRY_SLUG_MIN_LENGTH = 2;
export const REGISTRY_SLUG_MAX_LENGTH = 40;
// A copy of the workspace slug grammar in @shipfox/api-common-dto, which is an API package.
export const REGISTRY_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const REGISTRY_VERSION_PATTERN = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;

export interface RegistryVersion {
  major: number;
  minor: number;
  patch: number;
}

export interface RegistryPackageName {
  namespace: string;
  name: string;
}

export interface RegistryReference extends RegistryPackageName {
  version: string;
}

export function isRegistrySlug(value: string): boolean {
  return (
    value.length >= REGISTRY_SLUG_MIN_LENGTH &&
    value.length <= REGISTRY_SLUG_MAX_LENGTH &&
    REGISTRY_SLUG_PATTERN.test(value)
  );
}

/**
 * Parses an exact `MAJOR.MINOR.PATCH` version. Leading zeros, pre-release
 * tags, build metadata, and components above `Number.MAX_SAFE_INTEGER` are
 * rejected.
 */
export function parseRegistryVersion(value: string): RegistryVersion | undefined {
  const match = REGISTRY_VERSION_PATTERN.exec(value);
  if (!match) return undefined;
  const version = {major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3])};
  if (!Object.values(version).every(Number.isSafeInteger)) return undefined;
  return version;
}

export function isRegistryVersion(value: string): boolean {
  return parseRegistryVersion(value) !== undefined;
}

export function formatRegistryVersion({major, minor, patch}: RegistryVersion): string {
  return `${major}.${minor}.${patch}`;
}

/**
 * Orders two exact versions: negative when `a` is lower, positive when it is
 * higher, zero when equal. Throws on a string that is not an exact version.
 */
export function compareRegistryVersions(
  a: string | RegistryVersion,
  b: string | RegistryVersion,
): number {
  const left = toRegistryVersion(a);
  const right = toRegistryVersion(b);
  return left.major - right.major || left.minor - right.minor || left.patch - right.patch;
}

/** Parses `namespace/name`. */
export function parseRegistryPackageName(value: string): RegistryPackageName | undefined {
  const segments = value.split('/');
  if (segments.length !== 2) return undefined;
  const [namespace, name] = segments;
  if (namespace === undefined || name === undefined) return undefined;
  if (!(isRegistrySlug(namespace) && isRegistrySlug(name))) return undefined;
  return {namespace, name};
}

export function formatRegistryPackageName({namespace, name}: RegistryPackageName): string {
  return `${namespace}/${name}`;
}

/** Parses `namespace/name@MAJOR.MINOR.PATCH`. Ranges, tags, and a leading `@` are rejected. */
export function parseRegistryReference(value: string): RegistryReference | undefined {
  const separator = value.indexOf('@');
  if (separator === -1) return undefined;
  const packageName = parseRegistryPackageName(value.slice(0, separator));
  const version = value.slice(separator + 1);
  if (!(packageName && isRegistryVersion(version))) return undefined;
  return {...packageName, version};
}

export function formatRegistryReference({namespace, name, version}: RegistryReference): string {
  return `${formatRegistryPackageName({namespace, name})}@${version}`;
}

export const registrySlugSchema = z
  .string()
  .min(REGISTRY_SLUG_MIN_LENGTH)
  .max(REGISTRY_SLUG_MAX_LENGTH)
  .regex(REGISTRY_SLUG_PATTERN);

export const registryVersionSchema = z
  .string()
  .refine(isRegistryVersion, {message: 'Expected an exact version, such as 1.4.2'});

export const registryPackageNameSchema = z
  .string()
  .refine((value) => parseRegistryPackageName(value) !== undefined, {
    message: 'Expected a package name, such as shipfox/slack-thread-digest',
  });

export const registryReferenceSchema = z
  .string()
  .refine((value) => parseRegistryReference(value) !== undefined, {
    message: 'Expected an exact package reference, such as shipfox/slack-thread-digest@1.4.2',
  });

function toRegistryVersion(value: string | RegistryVersion): RegistryVersion {
  if (typeof value !== 'string') return value;
  const parsed = parseRegistryVersion(value);
  if (!parsed) throw new TypeError(`${JSON.stringify(value)} is not an exact registry version`);
  return parsed;
}
