import {
  type RegistryCatalog,
  type RegistryMetadata,
  type RegistryNamespaceProfile,
  type RegistryPackageIndex,
  registryCatalogSchema,
  registryMetadataSchema,
  registryNamespaceProfileSchema,
  registryPackageIndexSchema,
  registryVersionDocumentSchema,
} from '#documents.js';
import {actionVersionDocument, digest, templateVersionDocument} from '#test/fixtures/documents.js';

function roundTrip<T>(schema: {parse(value: unknown): T}, value: T): T {
  return schema.parse(JSON.parse(JSON.stringify(value)));
}

describe('registryVersionDocumentSchema', () => {
  it.each([
    ['action', actionVersionDocument()],
    ['template', templateVersionDocument()],
  ])('round-trips an %s document through JSON', (_kind, document) => {
    const result = roundTrip(registryVersionDocumentSchema, document);

    expect(result).toEqual(document);
  });

  it('accepts an action without README, changelog, or bump', () => {
    const {
      readme: _readme,
      changelog: _changelog,
      bump: _bump,
      ...document
    } = actionVersionDocument();

    const result = registryVersionDocumentSchema.safeParse(document);

    expect(result.success).toBe(true);
  });

  it('requires the content format of the document kind', () => {
    const document = {
      ...actionVersionDocument(),
      content: {digest: digest('a'), bytes: 1, format: 'template-bundle@1'},
    };

    const result = registryVersionDocumentSchema.safeParse(document);

    expect(result.success).toBe(false);
  });

  it('requires a composition format on templates', () => {
    const {composition: _composition, ...document} = templateVersionDocument();

    const result = registryVersionDocumentSchema.safeParse(document);

    expect(result.success).toBe(false);
  });

  it.each([
    ['an unknown schema major', {schema: 'shipfox.registry/version@2'}],
    ['a version range', {version: '^1.4.2'}],
    ['a one-character name', {package: 'shipfox/x'}],
    ['a non-exact action reference', {actions: ['shipfox/slack-thread-digest@1']}],
    ['an unprefixed digest', {fingerprint: 'f'.repeat(64)}],
  ])('rejects %s', (_case, override) => {
    const document = {...actionVersionDocument(), ...override};

    const result = registryVersionDocumentSchema.safeParse(document);

    expect(result.success).toBe(false);
  });
});

describe('index and profile schemas', () => {
  it('round-trips a package index', () => {
    const index: RegistryPackageIndex = {
      package: 'shipfox/slack-thread-digest',
      kind: 'action',
      versions: [
        {
          version: '1.0.0',
          digest: digest('1'),
          published_at: '2026-10-01T08:00:00Z',
          capability_change: false,
        },
        {
          version: '1.4.2',
          digest: digest('a'),
          published_at: '2026-10-12T09:14:03Z',
          bump: 'minor',
          capability_change: true,
        },
      ],
    };

    const result = roundTrip(registryPackageIndexSchema, index);

    expect(result).toEqual(index);
  });

  it('round-trips a catalog', () => {
    const catalog: RegistryCatalog = {
      packages: [
        {
          package: 'shipfox/ticket-to-pr',
          kind: 'template',
          title: 'Task to pull request',
          summary: 'Turn a ticket or a request into a tested GitHub pull request.',
          keywords: ['pull-request'],
          integrations: ['github', 'linear', 'jira'],
          latest: '1.2.0',
          published_at: '2026-10-12T09:14:03Z',
          first_published_at: '2026-10-01T08:00:00Z',
          featured: 1,
          publisher: {namespace: 'shipfox', display_name: 'Shipfox', verified: true},
        },
      ],
    };

    const result = roundTrip(registryCatalogSchema, catalog);

    expect(result).toEqual(catalog);
  });

  it('round-trips a namespace profile', () => {
    const profile: RegistryNamespaceProfile = {
      namespace: 'shipfox',
      display_name: 'Shipfox',
      url: 'https://www.shipfox.io',
      verified: true,
    };

    const result = roundTrip(registryNamespaceProfileSchema, profile);

    expect(result).toEqual(profile);
  });

  it('round-trips the well-known metadata', () => {
    const metadata: RegistryMetadata = {
      publish_url: 'https://registry.shipfox.io/v1/publish',
      keys: [{keyid: 'reg-2026-1', algorithm: 'ed25519', public_key: 'MCowBQYDK2VwAyEA'}],
    };

    const result = roundTrip(registryMetadataSchema, metadata);

    expect(result).toEqual(metadata);
  });
});
