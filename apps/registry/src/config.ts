import {createConfig, num, str, url} from '@shipfox/config';

export const config = createConfig({
  REGISTRY_PUBLIC_URL: url({
    desc: 'URL that clients use to reach the registry API, such as https://api.registry.shipfox.io. It is listed in .well-known/shipfox-registry.json and is the audience that GitHub Actions OIDC tokens must request, character for character.',
  }),
  REGISTRY_STORAGE_URL: str({
    desc: 'Where package blobs are stored. Use s3://bucket/prefix for S3, R2, or MinIO, with the connection from the OBJECT_STORAGE_S3_* settings. Use file:///absolute/path for development and E2E. The store must support conditional writes. Package metadata lives in Postgres, configured with the POSTGRES_* settings.',
  }),
  REGISTRY_CONTENT_URL: str({
    desc: 'Optional http(s) URL whose host replaces the storage endpoint host in presigned download URLs, such as https://content.registry.shipfox.io for a Tigris bucket on a custom domain. Leave it empty to keep the storage endpoint host. The file:// store streams downloads itself and ignores it.',
    default: undefined,
  }),
  REGISTRY_DOWNLOAD_TTL_SECONDS: num({
    desc: 'How long a presigned download URL stays valid, in seconds. Use a whole number from 1 to 604800. Clients follow the redirect at once, so keep it short.',
    default: 300,
  }),
  REGISTRY_SIGNING_KEY: str({
    desc: 'Ed25519 private key in PEM format that signs version documents. Escaped \\n sequences are read as newlines. Generate one with `openssl genpkey -algorithm ed25519`.',
  }),
  REGISTRY_SIGNING_KEY_ID: str({
    desc: 'Identifier of the signing key, written in each signature and in .well-known/shipfox-registry.json, such as reg-2026-1. Instances match it against their trusted keys, so use a new identifier when the key changes.',
  }),
  REGISTRY_BOOTSTRAP_PATH: str({
    desc: 'Path to the bootstrap YAML file that declares namespaces, their profiles and publishers, reserved names, and featured packages. The registry refuses to start when the file is missing or invalid.',
  }),
  REGISTRY_PUBLISH_HOOKS: str({
    desc: 'Optional comma-separated http(s) URLs called after each successful publish, such as a docs rebuild hook. Hook failures are logged and never fail the publish.',
    default: undefined,
  }),
});

export function publishHooks(value = config.REGISTRY_PUBLISH_HOOKS): string[] {
  const hooks = (value ?? '')
    .split(',')
    .map((hook) => hook.trim())
    .filter((hook) => hook !== '');
  for (const hook of hooks) {
    const protocol = URL.canParse(hook) ? new URL(hook).protocol : undefined;
    if (protocol !== 'http:' && protocol !== 'https:') {
      throw new Error(`REGISTRY_PUBLISH_HOOKS entry ${JSON.stringify(hook)} is not an http(s) URL`);
    }
  }
  return hooks;
}

export function contentUrl(value = config.REGISTRY_CONTENT_URL): URL | undefined {
  const trimmed = value?.trim() ?? '';
  if (trimmed === '') return undefined;
  const parsed = URL.canParse(trimmed) ? new URL(trimmed) : undefined;
  if (parsed?.protocol !== 'http:' && parsed?.protocol !== 'https:') {
    throw new Error(`REGISTRY_CONTENT_URL ${JSON.stringify(value)} is not an http(s) URL`);
  }
  return parsed;
}

export function downloadTtlSeconds(value = config.REGISTRY_DOWNLOAD_TTL_SECONDS): number {
  if (!Number.isInteger(value) || value < 1 || value > MAX_DOWNLOAD_TTL_SECONDS) {
    throw new Error(
      `REGISTRY_DOWNLOAD_TTL_SECONDS must be a whole number from 1 to ${MAX_DOWNLOAD_TTL_SECONDS}, got ${value}`,
    );
  }
  return value;
}

// The longest lifetime S3 accepts for a presigned URL.
const MAX_DOWNLOAD_TTL_SECONDS = 604_800;
