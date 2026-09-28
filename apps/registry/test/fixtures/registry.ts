import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {
  REGISTRY_VERSION_PAYLOAD_TYPE,
  type RegistryActionVersionDocument,
  registryVersionPath,
} from '@shipfox/registry-format';
import {JSON_CONTENT_TYPE, jsonBody} from '#indexes.js';
import {FileRegistryStorage} from '#storage/file.js';
import type {RegistryStorage} from '#storage/storage.js';

export const BOOTSTRAP_YAML = `
reserved: [shipfox-*, github]
featured: [shipfox/ticket-to-pr, shipfox/slack-thread-digest]
namespaces:
  shipfox:
    profile: {display_name: Shipfox, url: https://www.shipfox.io, verified: true}
    publishers:
      - provider: github
        repository_id: "812345678"
        repository_owner_id: "1234567"
        repository: ShipfoxHQ/shipfox
        workflow: .github/workflows/publish-packages.yml
  acme:
    status: suspended
    profile: {display_name: Acme}
`;

export async function createTemporaryRegistry() {
  const directory = await mkdtemp(join(tmpdir(), 'shipfox-registry-'));
  const storage = new FileRegistryStorage(join(directory, 'storage'));
  return {
    directory,
    storage,
    async writeBootstrap(text: string = BOOTSTRAP_YAML): Promise<string> {
      const path = join(directory, 'bootstrap.yaml');
      await writeFile(path, text);
      return path;
    },
    cleanup: () => rm(directory, {recursive: true, force: true}),
  };
}

export function digest(character: string): string {
  return `sha256:${character.repeat(64)}`;
}

export function actionVersionDocument(
  overrides: Partial<RegistryActionVersionDocument> = {},
): RegistryActionVersionDocument {
  return {
    schema: 'shipfox.registry/version@1',
    package: 'shipfox/slack-thread-digest',
    kind: 'action',
    version: '1.0.0',
    visibility: 'public',
    fingerprint: digest('f'),
    published_at: '2026-10-01T09:00:00Z',
    license: 'MIT',
    content: {digest: digest('a'), bytes: 100, format: 'action-bundle@1'},
    source: {digest: digest('b'), bytes: 200, format: 'source-archive@1'},
    manifest: {
      name: 'Slack thread digest',
      description: 'Turns a Slack thread into Markdown.',
      keywords: ['slack'],
    },
    derived: {
      integrations: ['slack'],
      capabilities: {
        slack: {provider: 'slack', selectors: ['conversations.replies'], allow_write: false},
      },
      interface: {inputs: {}, outputs: {}},
      usage: 'uses: shipfox/slack-thread-digest@1.0.0\nconnections:\n  slack: <slack connection>\n',
      size: 100,
    },
    dependencies: [],
    actions: [],
    builder: {tool: '@shipfox/registry-release', version: '0.1.0', recipe: 1},
    provenance: {
      issuer: 'https://token.actions.githubusercontent.com',
      repository: 'ShipfoxHQ/shipfox',
      repository_id: '812345678',
      repository_owner_id: '1234567',
      commit: '3066dabaa0000000000000000000000000000000',
      ref: 'refs/pull/2210/merge',
      workflow_ref: 'ShipfoxHQ/shipfox/.github/workflows/publish-packages.yml@refs/pull/2210/merge',
      run_id: '17000000001',
      run_attempt: '1',
      path: 'libs/shared/workflow/catalog/actions/slack-thread-digest',
    },
    ...overrides,
  };
}

export async function putVersionEnvelope(
  storage: RegistryStorage,
  document: RegistryActionVersionDocument,
): Promise<void> {
  const envelope = {
    payloadType: REGISTRY_VERSION_PAYLOAD_TYPE,
    payload: Buffer.from(JSON.stringify(document)).toString('base64'),
    signatures: [{keyid: 'test-key', sig: 'c2lnbmF0dXJl'}],
  };
  await storage.put({
    key: registryVersionPath(document),
    body: jsonBody(envelope),
    contentType: JSON_CONTENT_TYPE,
    ifNoneMatch: '*',
  });
}
