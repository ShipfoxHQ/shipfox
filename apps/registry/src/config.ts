import {bool, createConfig, str, url} from '@shipfox/config';

export const config = createConfig({
  REGISTRY_PUBLIC_URL: url({
    desc: 'URL that clients use to reach this registry, such as https://registry.shipfox.io. It is listed in .well-known/shipfox-registry.json and is the audience publish tokens must carry.',
  }),
  REGISTRY_STORAGE_URL: str({
    desc: 'Where registry files are stored. Use s3://bucket/prefix for S3, R2, or MinIO, with the connection from the OBJECT_STORAGE_S3_* settings. Use file:///absolute/path for development and E2E. The store must support conditional writes.',
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
  REGISTRY_SERVE_READS: bool({
    desc: 'Whether this service serves the public v1/ and .well-known/ files from storage. Keep true when self-hosting. Set false when a CDN serves the bucket directly.',
    default: true,
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
