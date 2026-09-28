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
  const json = serialize(value);
  if (json === undefined) throw new TypeError('Canonical JSON cannot encode undefined');
  return json;
}

// Writes object members directly instead of rebuilding an object: JavaScript
// would reorder integer-like keys and drop an own `__proto__` key.
function serialize(value: unknown): string | undefined {
  if (Array.isArray(value)) return `[${value.map((item) => serialize(item) ?? 'null').join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    // Code-unit order, not localeCompare, so the order never depends on the runtime locale.
    const members = Object.keys(record)
      .sort()
      .flatMap((key) => {
        const member = serialize(record[key]);
        return member === undefined ? [] : [`${JSON.stringify(key)}:${member}`];
      });
    return `{${members.join(',')}}`;
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new TypeError(`Canonical JSON cannot encode ${value}`);
  }
  return JSON.stringify(value);
}

async function sha256Digest(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return `sha256:${Array.from(hash, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}
