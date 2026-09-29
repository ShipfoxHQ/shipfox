import type {RegistryInterModuleClient} from '@shipfox/api-registry-dto/inter-module';
import {
  deriveActionMetadata,
  type RegistryActionVersionDocument,
  type RegistryBump,
  type RegistryCatalogEntry,
} from '@shipfox/registry-format';
import {
  type ActionBundleFile,
  actionManifestSchema,
  encodeActionBundle,
} from '@shipfox/workflow-document';

export const REGISTRY_PACKAGE = 'shipfox/slack-thread-digest';

export interface FakeRegistryVersion {
  version: string;
  bump?: RegistryBump;
  changelog?: string;
  inputs?: Record<string, {type?: 'string' | 'number' | 'boolean'; required?: boolean}>;
  integrations?: Record<string, {provider: string; include: string[]; allow_write?: boolean}>;
  dependencies?: {name: string; version: string}[];
  files?: ActionBundleFile[];
  readme?: string;
}

export interface FakeRegistry {
  client: RegistryInterModuleClient;
  calls: {resolveVersion: string[]};
}

const digest = (character: string) => `sha256:${character.repeat(64)}`;

/** An in-memory registry serving one action package, with real source archives. */
export async function createFakeRegistry(params: {
  versions: readonly FakeRegistryVersion[];
  catalog?: readonly RegistryCatalogEntry[];
}): Promise<FakeRegistry> {
  const documents = new Map<string, RegistryActionVersionDocument>();
  const sources = new Map<string, Uint8Array>();
  const readmes = new Map<string, string>();
  for (const fake of params.versions) {
    const files = fake.files ?? [
      {path: 'index.mjs', content: `export const v = '${fake.version}';`},
    ];
    const source = await encodeActionBundle({files});
    const manifest = actionManifestSchema.parse({
      name: 'Slack thread digest',
      description: 'Turns a Slack thread into Markdown.',
      main: 'index.mjs',
      inputs: fake.inputs ?? {},
      integrations: fake.integrations ?? {},
    });
    documents.set(fake.version, {
      schema: 'shipfox.registry/version@1',
      package: REGISTRY_PACKAGE,
      kind: 'action',
      version: fake.version,
      visibility: 'public',
      fingerprint: digest('f'),
      published_at: '2026-10-12T09:14:03Z',
      license: 'MIT',
      content: {digest: digest('a'), bytes: 10, format: 'action-bundle@1'},
      source: {digest: source.digest, bytes: source.bytes, format: 'source-archive@1'},
      ...(fake.readme === undefined
        ? {}
        : {readme: {digest: digest('c'), bytes: fake.readme.length}}),
      manifest,
      derived: deriveActionMetadata({
        reference: {namespace: 'shipfox', name: 'slack-thread-digest', version: fake.version},
        manifest,
        contentBytes: 10,
      }),
      dependencies: fake.dependencies ?? [],
      actions: [],
      ...(fake.changelog === undefined ? {} : {changelog: fake.changelog}),
      ...(fake.bump === undefined ? {} : {bump: fake.bump}),
      builder: {tool: '@shipfox/registry-release', version: '0.1.0', recipe: 1, mode: 'workspace'},
      provenance: {
        issuer: 'https://token.actions.githubusercontent.com',
        repository: 'ShipfoxHQ/shipfox',
        repository_id: '1',
        repository_owner_id: '1',
        commit: 'abc',
        ref: 'refs/heads/main',
        workflow_ref: 'ShipfoxHQ/shipfox/.github/workflows/publish.yml@refs/heads/main',
        run_id: '1',
        run_attempt: '1',
        path: 'libs/catalog/slack-thread-digest',
      },
    });
    sources.set(fake.version, source.gzip);
    if (fake.readme !== undefined) readmes.set(fake.version, fake.readme);
  }

  const calls = {resolveVersion: [] as string[]};
  const client = {
    getCatalog: () => Promise.resolve({packages: [...(params.catalog ?? [])]}),
    getPackageIndex: ({package: name}: {package: string}) =>
      Promise.resolve({
        index:
          name !== REGISTRY_PACKAGE
            ? null
            : {
                package: REGISTRY_PACKAGE,
                kind: 'action' as const,
                versions: params.versions.map(({version, bump}) => ({
                  version,
                  digest: digest('a'),
                  published_at: '2026-10-12T09:14:03Z',
                  ...(bump === undefined ? {} : {bump}),
                  capability_change: false,
                })),
              },
      }),
    resolveVersion: ({version}: {version: string}) => {
      calls.resolveVersion.push(version);
      const document = documents.get(version);
      if (document === undefined) return Promise.reject(new Error(`Unknown version ${version}`));
      return Promise.resolve({digest: digest('a'), document, content: ''});
    },
    getSource: ({version}: {version: string}) => {
      const source = sources.get(version);
      if (source === undefined) return Promise.reject(new Error(`Unknown version ${version}`));
      return Promise.resolve({source: Buffer.from(source).toString('base64')});
    },
    getReadme: ({version}: {version: string}) =>
      Promise.resolve({readme: readmes.get(version) ?? null}),
  };
  return {client: client as unknown as RegistryInterModuleClient, calls};
}

export function catalogEntry(name: string, overrides: Partial<RegistryCatalogEntry> = {}) {
  return {
    package: name,
    kind: 'action',
    title: name,
    summary: `The ${name} package.`,
    keywords: [],
    integrations: [],
    latest: '1.0.0',
    published_at: '2026-10-12T09:14:03Z',
    first_published_at: '2026-10-01T09:14:03Z',
    publisher: {namespace: 'shipfox', display_name: 'Shipfox', verified: true},
    ...overrides,
  } as RegistryCatalogEntry;
}
