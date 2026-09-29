import {createHash, generateKeyPairSync, randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import type {AddressInfo} from 'node:net';
import {
  createEd25519Signer,
  dssePreAuthenticationEncoding,
  type RegistryEnvelope,
  type RegistryPackageKind,
  type RegistrySigner,
  type RegistryTrustedKey,
  type RegistryVersionDocument,
  registryBlobKey,
  registryContentPath,
  registryReadmePath,
  registrySourcePath,
  registryVersionPath,
  signRegistryVersionDocument,
} from '@shipfox/registry-format';
import {encodeActionBundle} from '@shipfox/workflow-document';
import type {RegistrySettings} from '#core/settings.js';

export interface TestKey {
  signer: RegistrySigner;
  trusted: RegistryTrustedKey;
}

export async function createTestKey(keyid: string): Promise<TestKey> {
  const {privateKey, publicKey} = generateKeyPairSync('ed25519');
  const signer = await createEd25519Signer({
    keyid,
    privateKeyPem: privateKey.export({format: 'pem', type: 'pkcs8'}).toString(),
  });
  const spki = publicKey.export({format: 'der', type: 'spki'});
  return {signer, trusted: {keyid, public_key: spki.toString('base64')}};
}

export interface TestRegistry {
  /** Registry URL, unique per server. Rows are keyed by it, so tests do not share cache entries. */
  url: string;
  /** Paths requested so far, in order. */
  requests: string[];
  put(path: string, body: Uint8Array | string): void;
  /** Answers `path` with a 307 to `target`, like a presigned download URL. */
  redirect(path: string, target: string): void;
  fail(path: string, status: number): void;
  close(): Promise<void>;
}

export async function startTestRegistry(): Promise<TestRegistry> {
  const files = new Map<string, Uint8Array | string>();
  const redirects = new Map<string, string>();
  const failures = new Map<string, number>();
  const requests: string[] = [];
  // The OS can hand out a port again, and cached rows are keyed by URL, so the prefix keeps URLs unique.
  const prefix = `/${randomUUID()}/`;
  const server = createServer((request, response) => {
    const path = (request.url ?? '').slice(prefix.length - 1);
    requests.push(path);
    const status = failures.get(path);
    if (status) {
      response.writeHead(status).end();
      return;
    }
    const target = redirects.get(path);
    if (target !== undefined) {
      response.writeHead(307, {location: `${prefix}${target}`}).end();
      return;
    }
    const body = files.get(path);
    if (body === undefined) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200).end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const {port} = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}${prefix.slice(0, -1)}`,
    requests,
    put: (path, body) => files.set(path, body),
    redirect: (path, target) => redirects.set(path, target),
    fail: (path, status) => failures.set(path, status),
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}

export function settingsFor(params: {registry: TestRegistry; keys: TestKey[]}): RegistrySettings {
  return {registry: params.registry.url, trustedKeys: params.keys.map((key) => key.trusted)};
}

/** Where the test registry serves a blob that a download route redirects to. */
export function blobPath(digest: string): string {
  return `/${registryBlobKey(digest)}`;
}

export interface PublishedVersion {
  package: string;
  version: string;
  kind: RegistryPackageKind;
  document: RegistryVersionDocument;
  envelope: RegistryEnvelope;
  contentGzip: Uint8Array;
  sourceGzip: Uint8Array;
}

/** Signs a version and serves its envelope and blobs. */
export async function publishVersion(params: {
  registry: TestRegistry;
  key: TestKey;
  kind?: RegistryPackageKind;
  package?: string;
  version?: string;
  /** Omit for a version without a README. */
  readme?: string;
  /** Changes the bundles, so two registries can serve different content for one version. */
  variant?: string;
}): Promise<PublishedVersion> {
  const kind = params.kind ?? 'action';
  const packageName = params.package ?? 'fixture/example';
  const version = params.version ?? '1.0.0';
  const label = `${kind}:${packageName}@${version}:${params.variant ?? ''}`;

  const content = await encodeActionBundle({
    files: [{path: kind === 'action' ? 'action.yml' : 'template.yaml', content: `# ${label}\n`}],
  });
  const source = await encodeActionBundle({
    files: [{path: 'package.json', content: `{"name":"${label}"}`}],
  });
  const readmeBytes = params.readme === undefined ? undefined : Buffer.from(params.readme);
  const readme = readmeBytes && {
    digest: `sha256:${createHash('sha256').update(readmeBytes).digest('hex')}`,
    bytes: readmeBytes.length,
  };

  const document = versionDocument({
    kind,
    package: packageName,
    version,
    content: {digest: content.digest, bytes: content.bytes},
    source: {digest: source.digest, bytes: source.bytes},
    readme,
  });
  const envelope = await signRegistryVersionDocument({document, signer: params.key.signer});

  params.registry.put(
    registryVersionPath({package: packageName, version}),
    JSON.stringify(envelope),
  );
  params.registry.redirect(
    registryContentPath({package: packageName, version}),
    registryBlobKey(content.digest),
  );
  params.registry.put(blobPath(content.digest), content.gzip);
  params.registry.redirect(
    registrySourcePath({package: packageName, version}),
    registryBlobKey(source.digest),
  );
  params.registry.put(blobPath(source.digest), source.gzip);
  if (readmeBytes) {
    params.registry.put(registryReadmePath({package: packageName, version}), readmeBytes);
  }

  return {
    package: packageName,
    version,
    kind,
    document,
    envelope,
    contentGzip: content.gzip,
    sourceGzip: source.gzip,
  };
}

/** Signs an arbitrary payload the way the registry does, to publish what the format rejects. */
export async function signPayload(params: {
  key: TestKey;
  payload: unknown;
}): Promise<RegistryEnvelope> {
  const payloadType = 'application/vnd.shipfox.registry.version+json';
  const payload = Buffer.from(JSON.stringify(params.payload));
  const signature = await params.key.signer.sign(
    dssePreAuthenticationEncoding({payloadType, payload}),
  );
  return {
    payloadType,
    payload: payload.toString('base64'),
    signatures: [{keyid: params.key.signer.keyid, sig: Buffer.from(signature).toString('base64')}],
  };
}

function digestOf(character: string): string {
  return `sha256:${character.repeat(64)}`;
}

function versionDocument(params: {
  kind: RegistryPackageKind;
  package: string;
  version: string;
  content: {digest: string; bytes: number};
  source: {digest: string; bytes: number};
  readme?: {digest: string; bytes: number} | undefined;
}): RegistryVersionDocument {
  const base = {
    schema: 'shipfox.registry/version@1' as const,
    package: params.package,
    version: params.version,
    visibility: 'public' as const,
    fingerprint: digestOf('f'),
    published_at: '2026-10-12T09:14:03Z',
    license: 'MIT',
    source: {...params.source, format: 'source-archive@1' as const},
    ...(params.readme ? {readme: params.readme} : {}),
    actions: [],
    builder: {tool: '@shipfox/registry-release', version: '0.1.0', recipe: 1},
    provenance: {
      issuer: 'https://token.actions.githubusercontent.com',
      repository: 'ShipfoxHQ/shipfox',
      repository_id: '812345678',
      repository_owner_id: '1234567',
      commit: '3066dabaa0000000000000000000000000000000',
      ref: 'refs/heads/main',
      workflow_ref: 'ShipfoxHQ/shipfox/.github/workflows/publish-packages.yml@refs/heads/main',
      run_id: '17000000001',
      run_attempt: '1',
      path: `libs/shared/workflow/catalog/${params.kind}s/example`,
    },
  };
  if (params.kind === 'template') {
    return {
      ...base,
      kind: 'template',
      content: {...params.content, format: 'template-bundle@1'},
      manifest: {title: 'Example template', summary: 'A template.'},
      derived: {integrations: []},
      composition: 1,
    };
  }
  return {
    ...base,
    kind: 'action',
    content: {...params.content, format: 'action-bundle@1'},
    manifest: {name: 'Example', description: 'An action.', main: 'index.mjs'},
    derived: {
      integrations: [],
      capabilities: {},
      interface: {inputs: {}, outputs: {}},
      usage: `uses: ${params.package}@${params.version}\n`,
      size: params.content.bytes,
    },
    dependencies: [],
  };
}
