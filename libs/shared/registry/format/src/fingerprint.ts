import type {RegistryActionVersionDocument, RegistryVersionDocument} from '#documents.js';

export type FingerprintSource = Pick<
  RegistryVersionDocument,
  'package' | 'kind' | 'version' | 'license' | 'manifest' | 'changelog' | 'actions'
> & {
  content: {digest: string};
  source: {digest: string};
  readme?: {digest: string} | undefined;
  dependencies?: RegistryActionVersionDocument['dependencies'] | undefined;
  builder: {recipe: number};
};

/**
 * Identifies a publication independently of when and by which run it
 * happened: `published_at`, `provenance`, and the builder's tool version are
 * excluded, so a retried publish of identical content has the same
 * fingerprint. Accepts a full version document or a draft that has the same
 * fields.
 */
export function computeFingerprint(document: FingerprintSource): Promise<string> {
  const fields = {
    package: document.package,
    kind: document.kind,
    version: document.version,
    license: document.license,
    content: {digest: document.content.digest},
    source: {digest: document.source.digest},
    readme: document.readme ? {digest: document.readme.digest} : undefined,
    manifest: document.manifest,
    changelog: document.changelog,
    dependencies: document.dependencies,
    actions: document.actions,
    builder: {recipe: document.builder.recipe},
  };
  return sha256Digest(new TextEncoder().encode(canonicalJson(fields)));
}

/**
 * JSON with object keys sorted by code unit at every depth and no whitespace.
 * `undefined` object values are omitted, as `JSON.stringify` does.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new TypeError(`Canonical JSON cannot encode ${value}`);
    }
    return value;
  }
  const sorted: Record<string, unknown> = {};
  // Code-unit order, not localeCompare, so the order never depends on the runtime locale.
  for (const key of Object.keys(value).sort()) {
    sorted[key] = sortKeys((value as Record<string, unknown>)[key]);
  }
  return sorted;
}

async function sha256Digest(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return `sha256:${Array.from(hash, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}
