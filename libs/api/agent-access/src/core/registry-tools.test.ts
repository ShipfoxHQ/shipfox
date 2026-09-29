import {
  AGENT_ACCESS_REGISTRY_DIFF_PAGE_MAX_BYTES,
  AGENT_ACCESS_REGISTRY_README_MAX_BYTES,
  AGENT_ACCESS_REGISTRY_VERSIONS_MAX,
  AGENT_ACCESS_RESPONSE_MAX_BYTES,
  type AgentAccessEnvelopeDto,
  agentAccessEnvelopeSchema,
  diffRegistryActionResultSchema,
  getRegistryPackageResultSchema,
  listRegistryPackagesResultSchema,
} from '@shipfox/api-agent-access-dto';
import type {AgentAccessContext} from '@shipfox/api-auth-context';
import {
  type RegistryInterModuleClient,
  registryInterModuleContract,
} from '@shipfox/api-registry-dto/inter-module';
import {createInterModuleKnownError} from '@shipfox/inter-module';
import {
  catalogEntry,
  createFakeRegistry,
  type FakeRegistryVersion,
  REGISTRY_PACKAGE,
} from '#test/fixtures/registry.js';
import {createAgentAccessRegistryTools} from './registry-tools.js';
import {serializedAgentAccessEnvelopeByteLength} from './response.js';

const context: AgentAccessContext = {
  userId: '00000000-0000-4000-8000-000000000004',
  workspaceId: '00000000-0000-4000-8000-000000000001',
  credential: {
    kind: 'oauth_grant',
    grantId: '00000000-0000-4000-8000-000000000005',
    clientId: 'test',
  },
};

describe('list_registry_packages', () => {
  test('lists the catalog and filters by kind', async () => {
    const {client} = await createFakeRegistry({
      versions: [],
      catalog: [
        catalogEntry('shipfox/digest'),
        catalogEntry('shipfox/ticket-to-pr', {kind: 'template'}),
      ],
    });

    const all = await call(client, 'list_registry_packages', {});
    const templates = await call(client, 'list_registry_packages', {kind: 'template'});

    expect(resultOf(all).packages.map((entry: {package: string}) => entry.package)).toEqual([
      'shipfox/digest',
      'shipfox/ticket-to-pr',
    ]);
    expect(resultOf(templates).packages).toEqual([
      expect.objectContaining({package: 'shipfox/ticket-to-pr'}),
    ]);
    expect(listRegistryPackagesResultSchema.safeParse(resultOf(all)).success).toBe(true);
  });

  test('pages through the catalog with cursors', async () => {
    const names = Array.from({length: 120}, (_, index) => `shipfox/pkg-${index}`);
    const {client} = await createFakeRegistry({
      versions: [],
      catalog: names.map((name) => catalogEntry(name)),
    });

    const seen: string[] = [];
    let cursor: string | null | undefined;
    let pages = 0;
    do {
      const response = await call(client, 'list_registry_packages', {
        ...(cursor ? {cursor} : {}),
      });
      const result = resultOf(response);
      seen.push(...result.packages.map((entry: {package: string}) => entry.package));
      cursor = result.next_cursor;
      pages += 1;
    } while (cursor);

    expect(pages).toBe(3);
    expect(seen).toEqual(names);
  });

  test('rejects a malformed cursor and a cursor for a package that left the catalog', async () => {
    const {client} = await createFakeRegistry({
      versions: [],
      catalog: [catalogEntry('shipfox/a'), catalogEntry('shipfox/b')],
    });
    const stale = Buffer.from(JSON.stringify({after: 'shipfox/gone'})).toString('base64url');

    expect(await call(client, 'list_registry_packages', {cursor: 'nope'})).toMatchObject({
      ok: false,
      error: {code: 'invalid-request'},
    });
    expect(await call(client, 'list_registry_packages', {cursor: stale})).toMatchObject({
      ok: false,
      error: {code: 'invalid-request'},
    });
  });

  test('keeps a page under the response ceiling and resumes after the last retained entry', async () => {
    const summary = 'x'.repeat(8 * 1024);
    const names = Array.from({length: 50}, (_, index) => `shipfox/pkg-${index}`);
    const {client} = await createFakeRegistry({
      versions: [],
      catalog: names.map((name) => catalogEntry(name, {summary})),
    });

    const first = await call(client, 'list_registry_packages', {});
    const retained = resultOf(first).packages;

    expect(serializedAgentAccessEnvelopeByteLength(first)).toBeLessThanOrEqual(
      AGENT_ACCESS_RESPONSE_MAX_BYTES,
    );
    expect(retained.length).toBeLessThan(names.length);
    const second = await call(client, 'list_registry_packages', {
      cursor: resultOf(first).next_cursor,
    });
    expect(resultOf(second).packages[0]).toMatchObject({package: names[retained.length]});
  });

  test('reports a registry outage as a tool error', async () => {
    const {client} = await createFakeRegistry({versions: []});
    const failing = withFailure(client, 'getCatalog', 'registry-unavailable');

    expect(await call(failing, 'list_registry_packages', {})).toMatchObject({
      ok: false,
      error: {code: 'registry-unavailable'},
    });
  });

  test('reports a registry that is not configured', async () => {
    const {client} = await createFakeRegistry({versions: []});
    const failing = withFailure(client, 'getCatalog', 'registry-disabled');

    expect(await call(failing, 'list_registry_packages', {})).toMatchObject({
      ok: false,
      error: {code: 'registry-disabled'},
    });
  });
});

describe('get_registry_package', () => {
  test('returns the latest version by default with its facts', async () => {
    const {client} = await createFakeRegistry({
      versions: [
        {version: '1.0.0'},
        {
          version: '1.10.0',
          bump: 'minor',
          changelog: '- Adds reactions.',
          readme: '# Digest',
          dependencies: [{name: 'yaml', version: '2.8.0'}],
        },
        {version: '1.9.0', bump: 'minor'},
      ],
    });

    const response = await call(client, 'get_registry_package', {package: REGISTRY_PACKAGE});
    const result = resultOf(response);

    expect(result).toMatchObject({
      package: REGISTRY_PACKAGE,
      kind: 'action',
      version: '1.10.0',
      latest_version: '1.10.0',
      bump: 'minor',
      changelog: '- Adds reactions.',
      dependencies: [{name: 'yaml', version: '2.8.0'}],
      readme: '# Digest',
      readme_truncated: false,
    });
    expect(result.versions.map((entry: {version: string}) => entry.version)).toEqual([
      '1.10.0',
      '1.9.0',
      '1.0.0',
    ]);
    expect(getRegistryPackageResultSchema.safeParse(result).success).toBe(true);
  });

  test('returns a named version, and none of a version the package lacks', async () => {
    const {client} = await createFakeRegistry({versions: [{version: '1.0.0'}, {version: '1.1.0'}]});

    const named = await call(client, 'get_registry_package', {
      package: REGISTRY_PACKAGE,
      version: '1.0.0',
    });
    const missing = await call(client, 'get_registry_package', {
      package: REGISTRY_PACKAGE,
      version: '9.0.0',
    });

    expect(resultOf(named)).toMatchObject({version: '1.0.0', latest_version: '1.1.0'});
    expect(missing).toMatchObject({ok: false, error: {code: 'not-found'}});
  });

  test('reports an unknown package as not found', async () => {
    const {client} = await createFakeRegistry({versions: [{version: '1.0.0'}]});

    expect(await call(client, 'get_registry_package', {package: 'shipfox/nothing'})).toMatchObject({
      ok: false,
      error: {code: 'not-found'},
    });
  });

  test('cuts the README at 32 KiB and lists at most 50 versions', async () => {
    const versions: FakeRegistryVersion[] = Array.from({length: 60}, (_, index) => ({
      version: `1.${index}.0`,
      ...(index === 59 ? {readme: '€'.repeat(40 * 1024)} : {}),
    }));
    const {client} = await createFakeRegistry({versions});

    const response = await call(client, 'get_registry_package', {package: REGISTRY_PACKAGE});
    const result = resultOf(response);

    expect(Buffer.byteLength(result.readme)).toBeLessThanOrEqual(
      AGENT_ACCESS_REGISTRY_README_MAX_BYTES,
    );
    expect(result.readme_truncated).toBe(true);
    expect(result.versions).toHaveLength(AGENT_ACCESS_REGISTRY_VERSIONS_MAX);
    expect(result.versions[0]).toMatchObject({version: '1.59.0'});
    expect(serializedAgentAccessEnvelopeByteLength(response)).toBeLessThanOrEqual(
      AGENT_ACCESS_RESPONSE_MAX_BYTES,
    );
  });

  test('keeps the response under the ceiling with the largest README and changelog', async () => {
    const {client} = await createFakeRegistry({
      versions: [
        {
          version: '1.0.0',
          readme: '"\n'.repeat(64 * 1024),
          changelog: '"\n'.repeat(64 * 1024),
          dependencies: Array.from({length: 200}, (_, index) => ({
            name: `dependency-${index}`,
            version: '1.0.0',
          })),
        },
      ],
    });

    const response = await call(client, 'get_registry_package', {package: REGISTRY_PACKAGE});

    expect(response.ok).toBe(true);
    expect(serializedAgentAccessEnvelopeByteLength(response)).toBeLessThanOrEqual(
      AGENT_ACCESS_RESPONSE_MAX_BYTES,
    );
  });

  test('reports a version that fails verification', async () => {
    const {client} = await createFakeRegistry({versions: [{version: '1.0.0'}]});
    const failing = withFailure(client, 'resolveVersion', 'registry-signature-invalid', {
      package: REGISTRY_PACKAGE,
      version: '1.0.0',
    });

    expect(await call(failing, 'get_registry_package', {package: REGISTRY_PACKAGE})).toMatchObject({
      ok: false,
      error: {code: 'registry-signature-invalid'},
    });
  });

  test('rethrows a failure that is not a registry error', async () => {
    const {client} = await createFakeRegistry({versions: [{version: '1.0.0'}]});
    const broken = {
      ...client,
      getPackageIndex: () => Promise.reject(new Error('boom')),
    } as unknown as RegistryInterModuleClient;

    await expect(call(broken, 'get_registry_package', {package: REGISTRY_PACKAGE})).rejects.toThrow(
      'boom',
    );
  });
});

describe('diff_registry_action', () => {
  const versions: FakeRegistryVersion[] = [
    {
      version: '1.0.0',
      inputs: {channel: {type: 'string', required: true}},
      integrations: {slack: {provider: 'slack', include: ['conversations'], allow_write: false}},
      dependencies: [
        {name: 'yaml', version: '2.7.0'},
        {name: 'removed-dep', version: '1.0.0'},
      ],
      files: [
        {path: 'index.mjs', content: 'const a = 1;\nconsole.log(a);\n'},
        {path: 'LICENSE', content: 'MIT'},
      ],
    },
    {version: '1.1.0', bump: 'minor', changelog: '- Adds reactions.'},
    {version: '1.2.0', bump: 'patch', changelog: '- Fixes threads.'},
    {
      version: '2.0.0',
      bump: 'major',
      changelog: '- Writes to Slack.',
      inputs: {
        channel: {type: 'string', required: true},
        reactions: {type: 'boolean', required: false},
      },
      integrations: {
        slack: {provider: 'slack', include: ['conversations', 'reactions'], allow_write: true},
      },
      dependencies: [
        {name: 'yaml', version: '2.8.0'},
        {name: 'added-dep', version: '3.0.0'},
      ],
      files: [
        {path: 'index.mjs', content: 'const a = 2;\nconsole.log(a);\n'},
        {path: 'NOTICE', content: 'Notice'},
      ],
    },
  ];

  test('reports the bump, capability changes, manifest and dependency changes, and changelog', async () => {
    const {client} = await createFakeRegistry({versions});

    const response = await call(client, 'diff_registry_action', {
      package: REGISTRY_PACKAGE,
      from: '1.0.0',
      to: '2.0.0',
    });
    const result = resultOf(response);

    expect(result.bump).toBe('major');
    expect(result.capability_changes).toEqual([
      {type: 'write_enabled', alias: 'slack'},
      {type: 'selectors_added', alias: 'slack', selectors: ['reactions']},
    ]);
    expect(Object.keys(result.manifest_changes.inputs.added)).toEqual(['reactions']);
    expect(result.manifest_changes.integrations.changed).toHaveProperty('slack');
    expect(result.dependency_changes).toEqual([
      {name: 'added-dep', from: null, to: '3.0.0'},
      {name: 'removed-dep', from: '1.0.0', to: null},
      {name: 'yaml', from: '2.7.0', to: '2.8.0'},
    ]);
    expect(result.changelog).toEqual([
      {version: '1.1.0', markdown: '- Adds reactions.'},
      {version: '1.2.0', markdown: '- Fixes threads.'},
      {version: '2.0.0', markdown: '- Writes to Slack.'},
    ]);
    expect(diffRegistryActionResultSchema.safeParse(result).success).toBe(true);
  });

  test('reports the highest bump over the skipped versions only', async () => {
    const {client} = await createFakeRegistry({versions});

    const response = await call(client, 'diff_registry_action', {
      package: REGISTRY_PACKAGE,
      from: '1.1.0',
      to: '1.2.0',
    });

    expect(resultOf(response)).toMatchObject({bump: 'patch', changelog: [{version: '1.2.0'}]});
  });

  test('returns a unified diff of the source files, in path order', async () => {
    const {client} = await createFakeRegistry({versions});

    const response = await call(client, 'diff_registry_action', {
      package: REGISTRY_PACKAGE,
      from: '1.0.0',
      to: '2.0.0',
    });
    const diff: string = resultOf(response).source_diff;

    expect(diff.indexOf('--- a/LICENSE')).toBeLessThan(diff.indexOf('--- /dev/null'));
    expect(diff).toContain('--- a/LICENSE\n+++ /dev/null');
    expect(diff).toContain('--- /dev/null\n+++ b/NOTICE');
    expect(diff).toContain('--- a/index.mjs\n+++ b/index.mjs');
    expect(diff).toContain('-const a = 1;\n+const a = 2;');
    expect(resultOf(response).next_cursor).toBeNull();
  });

  test('pages the source diff by file, with metadata on the first page only', async () => {
    const files = (seed: string) =>
      Array.from({length: 6}, (_, index) => ({
        path: `file-${index}.txt`,
        content: Array.from({length: 600}, (_line, line) => `${seed} ${index} line ${line}`).join(
          '\n',
        ),
      }));
    const {client} = await createFakeRegistry({
      versions: [
        {version: '1.0.0', files: files('old')},
        {version: '1.1.0', bump: 'minor', changelog: '- Rewrites.', files: files('new')},
      ],
    });

    const pages: Record<string, unknown>[] = [];
    let cursor: string | null = null;
    do {
      const response: AgentAccessEnvelopeDto = await call(client, 'diff_registry_action', {
        package: REGISTRY_PACKAGE,
        from: '1.0.0',
        to: '1.1.0',
        ...(cursor === null ? {} : {cursor}),
      });
      expect(serializedAgentAccessEnvelopeByteLength(response)).toBeLessThanOrEqual(
        AGENT_ACCESS_RESPONSE_MAX_BYTES,
      );
      const result = resultOf(response);
      expect(diffRegistryActionResultSchema.safeParse(result).success).toBe(true);
      pages.push(result);
      cursor = result.next_cursor;
    } while (cursor !== null);

    expect(pages.length).toBeGreaterThan(1);
    expect(pages[0]).toHaveProperty('changelog');
    for (const later of pages.slice(1)) {
      expect(Object.keys(later).sort()).toEqual([
        'from',
        'next_cursor',
        'package',
        'source_diff',
        'to',
      ]);
    }
    const combined = pages.map((page) => page.source_diff as string).join('');
    for (let index = 0; index < 6; index += 1) {
      expect(combined.match(new RegExp(`^--- a/file-${index}\\.txt$`, 'gm'))).toHaveLength(1);
    }
    for (const page of pages) {
      expect(Buffer.byteLength(page.source_diff as string)).toBeLessThanOrEqual(
        AGENT_ACCESS_REGISTRY_DIFF_PAGE_MAX_BYTES,
      );
    }
  });

  test('cuts a file that alone exceeds the page and still advances', async () => {
    const big = (seed: string) =>
      Array.from({length: 20_000}, (_, line) => `"${seed}" ${line}`).join('\n');
    const {client} = await createFakeRegistry({
      versions: [
        {
          version: '1.0.0',
          files: [
            {path: 'a-big.txt', content: big('old')},
            {path: 'b-small.txt', content: 'one'},
          ],
        },
        {
          version: '1.1.0',
          bump: 'patch',
          files: [
            {path: 'a-big.txt', content: big('new')},
            {path: 'b-small.txt', content: 'two'},
          ],
        },
      ],
    });

    const first = await call(client, 'diff_registry_action', {
      package: REGISTRY_PACKAGE,
      from: '1.0.0',
      to: '1.1.0',
    });
    const second = await call(client, 'diff_registry_action', {
      package: REGISTRY_PACKAGE,
      from: '1.0.0',
      to: '1.1.0',
      cursor: resultOf(first).next_cursor,
    });

    expect(serializedAgentAccessEnvelopeByteLength(first)).toBeLessThanOrEqual(
      AGENT_ACCESS_RESPONSE_MAX_BYTES,
    );
    expect(resultOf(first).source_diff).toContain('Patch of a-big.txt cut at the page limit');
    expect(resultOf(second).source_diff).toContain('--- a/b-small.txt');
    expect(resultOf(second).next_cursor).toBeNull();
  });

  test('keeps the first page under the ceiling when the changelog is large', async () => {
    const changelog = '"\n'.repeat(8 * 1024);
    const files = (seed: string) =>
      Array.from({length: 4}, (_, index) => ({
        path: `file-${index}.txt`,
        content: Array.from({length: 2000}, (_line, line) => `"${seed}" ${line}`).join('\n'),
      }));
    const {client} = await createFakeRegistry({
      versions: [
        {version: '1.0.0', files: files('old')},
        ...Array.from({length: 12}, (_, index) => ({
          version: `1.${index + 1}.0`,
          bump: 'patch' as const,
          changelog,
          files: files('new'),
        })),
      ],
    });

    const response = await call(client, 'diff_registry_action', {
      package: REGISTRY_PACKAGE,
      from: '1.0.0',
      to: '1.12.0',
    });

    expect(response.ok).toBe(true);
    expect(resultOf(response).changelog_truncated).toBe(true);
    expect(serializedAgentAccessEnvelopeByteLength(response)).toBeLessThanOrEqual(
      AGENT_ACCESS_RESPONSE_MAX_BYTES,
    );
  });

  test('rejects versions that are out of order, unknown, or a template', async () => {
    const {client} = await createFakeRegistry({versions});

    expect(
      await call(client, 'diff_registry_action', {
        package: REGISTRY_PACKAGE,
        from: '2.0.0',
        to: '1.0.0',
      }),
    ).toMatchObject({ok: false, error: {code: 'invalid-request'}});
    expect(
      await call(client, 'diff_registry_action', {
        package: REGISTRY_PACKAGE,
        from: '1.0.0',
        to: '9.9.9',
      }),
    ).toMatchObject({ok: false, error: {code: 'not-found'}});
    expect(
      await call(client, 'diff_registry_action', {
        package: 'shipfox/nothing',
        from: '1.0.0',
        to: '2.0.0',
      }),
    ).toMatchObject({ok: false, error: {code: 'not-found'}});

    const template = {
      ...client,
      getPackageIndex: async () => ({
        index: {package: 'shipfox/ticket-to-pr', kind: 'template', versions: []},
      }),
    } as unknown as RegistryInterModuleClient;
    expect(
      await call(template, 'diff_registry_action', {
        package: 'shipfox/ticket-to-pr',
        from: '1.0.0',
        to: '2.0.0',
      }),
    ).toMatchObject({ok: false, error: {code: 'invalid-request'}});
  });

  test('rejects a cursor that does not point into the diff', async () => {
    const {client} = await createFakeRegistry({versions});
    const past = Buffer.from(JSON.stringify({file: 50})).toString('base64url');

    for (const cursor of ['nope', past]) {
      expect(
        await call(client, 'diff_registry_action', {
          package: REGISTRY_PACKAGE,
          from: '1.0.0',
          to: '2.0.0',
          cursor,
        }),
      ).toMatchObject({ok: false, error: {code: 'invalid-request'}});
    }
  });
});

async function call(
  registry: RegistryInterModuleClient,
  name: string,
  input: Record<string, unknown>,
): Promise<AgentAccessEnvelopeDto> {
  const tool = createAgentAccessRegistryTools({registry}).find(
    (candidate) => candidate.name === name,
  );
  if (!tool) throw new Error(`Missing tool ${name}`);
  const response = await tool.execute({context, arguments: input});
  expect(agentAccessEnvelopeSchema.safeParse(response).success).toBe(true);
  return response;
}

// biome-ignore lint/suspicious/noExplicitAny: test assertions read untyped tool results
function resultOf(envelope: AgentAccessEnvelopeDto): any {
  if (!envelope.ok) throw new Error(`Tool failed: ${JSON.stringify(envelope.error)}`);
  return envelope.result;
}

function withFailure(
  registry: RegistryInterModuleClient,
  method: 'getCatalog' | 'resolveVersion',
  code: 'registry-disabled' | 'registry-unavailable' | 'registry-signature-invalid',
  details: Record<string, unknown> = {},
): RegistryInterModuleClient {
  const error = createInterModuleKnownError(
    registryInterModuleContract.methods[method],
    code as never,
    details as never,
  );
  return {
    ...registry,
    [method]: () => Promise.reject(error),
  } as unknown as RegistryInterModuleClient;
}
