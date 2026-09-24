import {
  assertAgentToolCatalogRepositoryScopes,
  type IntegrationConnection,
} from '@shipfox/api-integration-spi';
import type {SentryReadClient} from '#core/read-client.js';
import {sentryAgentToolCatalog} from './agent-tools.js';
import {SentryAgentToolsProvider} from './agent-tools-provider.js';

const connection: IntegrationConnection<'sentry'> = {
  id: 'connection-1',
  workspaceId: 'workspace-1',
  provider: 'sentry',
  externalAccountId: 'installation-1',
  slug: 'sentry',
  displayName: 'Sentry',
  lifecycleStatus: 'active',
  repositoryAccessMode: 'all',
  createdAt: new Date(),
  updatedAt: new Date(),
};
const ISSUE_EXCLUDED = /secret|headers|contexts|tags|users/;
const EVENT_EXCLUDED = /secret|breadcrumbs|attachments|contexts|vars|request/;

function setup() {
  const client = {
    sourceUrl: vi.fn(
      async (_connectionId: string, resource: 'projects' | 'issues', issueId?: string) =>
        issueId
          ? `https://sentry.io/organizations/acme/issues/${issueId}/`
          : `https://sentry.io/organizations/acme/${resource}/`,
    ),
    listProjects: vi.fn(
      async (
        _input: Parameters<SentryReadClient['listProjects']>[0],
      ): ReturnType<SentryReadClient['listProjects']> => ({
        data: [{id: '1', slug: 'api', name: 'API'}],
        nextCursor: null,
      }),
    ),
    searchIssues: vi.fn(
      async (
        _input: Parameters<SentryReadClient['searchIssues']>[0],
      ): ReturnType<SentryReadClient['searchIssues']> => ({data: [], nextCursor: null}),
    ),
    getIssue: vi.fn(
      async (
        _input: Parameters<SentryReadClient['getIssue']>[0],
      ): ReturnType<SentryReadClient['getIssue']> => ({id: '42', title: 'Failure'}),
    ),
    getIssueEvent: vi.fn(
      async (
        _input: Parameters<SentryReadClient['getIssueEvent']>[0],
      ): ReturnType<SentryReadClient['getIssueEvent']> => ({id: 'event-1', groupID: '42'}),
    ),
  };
  const provider = new SentryAgentToolsProvider(client as unknown as SentryReadClient);
  const session = provider.openSession({
    connection,
    tools: sentryAgentToolCatalog,
    scope: undefined,
  });
  const call = async (toolId: string, args: Record<string, unknown> = {}) => {
    const response = await (await session).call({toolId, arguments: args});
    return {
      response,
      data: response.isError ? undefined : JSON.parse(response.content[0]?.text ?? '{}'),
    };
  };
  return {client, provider, call};
}

describe('Sentry agent tools', () => {
  it('publishes four strict, read-only, connection-scoped standalone tools', () => {
    const {provider} = setup();
    expect(provider.catalog().map((tool) => tool.id)).toEqual([
      'list-projects',
      'search-issues',
      'get-issue',
      'get-issue-event',
    ]);
    expect(provider.selectionCatalog().selectors.map((selector) => selector.token)).toEqual(
      provider.catalog().map((tool) => tool.id),
    );
    expect(provider.catalog().every((tool) => tool.sensitivity === 'read')).toBe(true);
    expect(
      provider.catalog().every((tool) => tool.inputSchema.additionalProperties === false),
    ).toBe(true);
    expect(
      provider.catalog().every((tool) => tool.repositoryScope?.({}).kind === 'connection'),
    ).toBe(true);
    expect(() => assertAgentToolCatalogRepositoryScopes(provider.catalog())).not.toThrow();
  });

  it('dispatches project listing and forwards the Sentry cursor unchanged', async () => {
    const {client, call} = setup();
    client.listProjects.mockResolvedValueOnce({
      data: [{id: '1', slug: 'api', name: 'API', secret: 'excluded'}],
      nextCursor: 'opaque:cursor',
    });
    const {data, response} = await call('list-projects', {
      query: '',
      limit: 5,
      cursor: 'prior:cursor',
    });
    expect(client.listProjects).toHaveBeenCalledWith({
      connectionId: connection.id,
      query: '',
      limit: 5,
      cursor: 'prior:cursor',
    });
    expect(data).toEqual({
      data: [{id: '1', slug: 'api', name: 'API'}],
      nextCursor: 'opaque:cursor',
      truncated: false,
      sourceUrl: 'https://sentry.io/organizations/acme/projects/',
    });
    expect(response.structuredContent).toEqual(data);
  });

  it('applies search defaults, preserves an empty query, and sends explicit filters', async () => {
    const {client, call} = setup();
    await call('search-issues');
    expect(client.searchIssues).toHaveBeenLastCalledWith({
      connectionId: connection.id,
      query: 'is:unresolved',
      statsPeriod: '24h',
      sort: 'date',
      limit: 20,
    });

    client.searchIssues.mockResolvedValueOnce({data: [], nextCursor: 'next:page'});
    const {data} = await call('search-issues', {
      query: '',
      projectIds: ['12'],
      environments: ['production'],
      start: '2026-09-23T00:00:00Z',
      end: '2026-09-24T00:00:00Z',
      sort: 'freq',
      limit: 100,
      cursor: 'current:page',
    });
    expect(client.searchIssues).toHaveBeenLastCalledWith({
      connectionId: connection.id,
      query: '',
      projectIds: ['12'],
      environments: ['production'],
      start: '2026-09-23T00:00:00Z',
      end: '2026-09-24T00:00:00Z',
      sort: 'freq',
      limit: 100,
      cursor: 'current:page',
    });
    expect(data.nextCursor).toBe('next:page');
    expect(data.data).toEqual([]);
  });

  it('rejects unknown fields, invalid time windows, and unselected tools before reading', async () => {
    const {client, call, provider} = setup();
    for (const args of [
      {issueId: '42', environment: 'production'},
      {issueId: '42', installationUuid: 'other'},
    ]) {
      expect((await call('get-issue', args)).response.isError).toBe(true);
    }
    for (const args of [
      {start: '2026-09-23T00:00:00Z'},
      {start: '2026-09-23T00:00:00Z', end: '2026-09-24T00:00:00Z', statsPeriod: '24h'},
      {sort: 'invalid'},
      {statsPeriod: 'tomorrow'},
      {limit: 101},
    ]) {
      expect((await call('search-issues', args)).response.isError).toBe(true);
    }
    const selected = await provider.openSession({
      connection,
      tools: sentryAgentToolCatalog.slice(0, 1),
      scope: undefined,
    });
    expect((await selected.call({toolId: 'get-issue', arguments: {issueId: '42'}})).isError).toBe(
      true,
    );
    expect(client.getIssue).not.toHaveBeenCalled();
    expect(client.searchIssues).not.toHaveBeenCalled();
  });

  it('projects issue counts only with known scope and excludes provider extras', async () => {
    const {client, call} = setup();
    client.getIssue.mockResolvedValueOnce({
      id: '42',
      title: 'Failure',
      status: 'unresolved',
      permalink: 'https://sentry.io/acme/api/issues/42/',
      count: '999',
      lifetime: {count: '999', userCount: 12, users: [{email: 'secret@example.com'}]},
      filtered: {count: '3'},
      project: {id: '12', slug: 'api', name: 'API', token: 'secret'},
      user: {email: 'secret@example.com'},
      tags: [{key: 'secret'}],
      contexts: {request: {headers: {authorization: 'secret'}}},
    });
    const {data, response} = await call('get-issue', {issueId: '42'});
    expect(client.getIssue).toHaveBeenCalledWith({connectionId: connection.id, issueId: '42'});
    expect(data.data).toEqual({
      id: '42',
      title: 'Failure',
      status: 'unresolved',
      permalink: 'https://sentry.io/acme/api/issues/42/',
      lifetime: {count: '999', userCount: 12},
      filtered: {count: '3'},
      project: {id: '12', slug: 'api', name: 'API'},
    });
    expect(data.nextCursor).toBeNull();
    expect(JSON.stringify(response)).not.toMatch(ISSUE_EXCLUDED);
  });

  it('projects only event evidence, keeps missing frames missing, and caps each exception at 50 frames', async () => {
    const {client, call} = setup();
    const frames = Array.from({length: 60}, (_, index) => ({
      function: `fn-${index}`,
      filename: 'app.ts',
      lineNo: index,
      inApp: index >= 40,
      vars: {token: 'secret'},
      preContext: ['source line'],
      context: [[index, 'source line']],
    }));
    client.getIssueEvent.mockResolvedValueOnce({
      id: 'event-1',
      groupID: '42',
      dateCreated: '2026-09-24T00:00:00Z',
      release: {version: 'v1', metadata: {secret: true}},
      entries: [
        {
          type: 'exception',
          data: {
            values: [
              {
                type: 'TypeError',
                value: 'Failure',
                mechanism: {type: 'generic', secret: true},
                stacktrace: {frames},
              },
            ],
          },
        },
      ],
      request: {data: 'secret'},
      breadcrumbs: [{message: 'secret'}],
      user: {email: 'secret@example.com'},
      contexts: {secret: true},
      attachments: [{name: 'secret'}],
    });
    const {data, response} = await call('get-issue-event', {
      issueId: '42',
      environments: ['production'],
    });
    expect(client.getIssueEvent).toHaveBeenCalledWith({
      connectionId: connection.id,
      issueId: '42',
      environments: ['production'],
    });
    expect(data.truncated).toBe(true);
    expect(data.data).toMatchObject({id: 'event-1', issueId: '42', release: 'v1'});
    expect(data.data.exceptions[0].frames).toHaveLength(50);
    expect(
      data.data.exceptions[0].frames.filter((frame: {inApp: boolean}) => frame.inApp),
    ).toHaveLength(20);
    expect(data.data.exceptions[0].frames[0].function).toBe('fn-0');
    expect(data.data.exceptions[0].frames[0].sourceContext).toEqual([
      {line: 0, text: 'source line'},
    ]);
    expect(
      data.data.exceptions[0].frames.some(
        (frame: {function: string}) => frame.function === 'fn-30',
      ),
    ).toBe(false);
    expect(JSON.stringify(response)).not.toMatch(EVENT_EXCLUDED);

    client.getIssueEvent.mockResolvedValueOnce({id: 'event-2', groupID: '42'});
    const missing = await call('get-issue-event', {issueId: '42', eventId: 'latest'});
    expect(client.getIssueEvent).toHaveBeenLastCalledWith({
      connectionId: connection.id,
      issueId: '42',
      eventId: 'latest',
    });
    expect(missing.data.data).toEqual({id: 'event-2', issueId: '42'});
    expect(missing.data.truncated).toBe(false);
  });

  it('caps the serialized result at 64 KiB while retaining identifiers and a source link', async () => {
    const {client, call} = setup();
    client.getIssue.mockResolvedValueOnce({id: '42', title: 'x'.repeat(100_000)});

    const {data, response} = await call('get-issue', {issueId: '42'});

    expect(data.truncated).toBe(true);
    expect(data.data.id).toBe('42');
    expect(data.sourceUrl).toContain('/issues/42/');
    expect(Buffer.byteLength(JSON.stringify(response))).toBeLessThanOrEqual(64 * 1024);
  });

  it('keeps every issue on an oversized page before forwarding its cursor', async () => {
    const {client, call} = setup();
    const issues = Array.from({length: 100}, (_, index) => ({
      id: String(index),
      title: 'x'.repeat(500),
    }));
    client.searchIssues.mockResolvedValueOnce({data: issues, nextCursor: 'opaque:next'});

    const {data, response} = await call('search-issues', {limit: 100});

    expect(data.truncated).toBe(true);
    expect(data.data.map((issue: {id: string}) => issue.id)).toEqual(
      issues.map((issue) => issue.id),
    );
    expect(data.nextCursor).toBe('opaque:next');
    expect(Buffer.byteLength(JSON.stringify(response))).toBeLessThanOrEqual(64 * 1024);
  });

  it('keeps in-app frames across exceptions when trimming an oversized event', async () => {
    const {client, call} = setup();
    const libraryFrames = Array.from({length: 50}, (_, index) => ({
      function: `library-${index}-${'x'.repeat(800)}`,
      inApp: false,
    }));
    client.getIssueEvent.mockResolvedValueOnce({
      id: 'event-4',
      groupID: '42',
      entries: [
        {
          type: 'exception',
          data: {
            values: [
              {type: 'LibraryError', stacktrace: {frames: libraryFrames}},
              {type: 'AppError', stacktrace: {frames: [{function: 'app', inApp: true}]}},
            ],
          },
        },
      ],
    });

    const {data, response} = await call('get-issue-event', {issueId: '42'});

    expect(data.truncated).toBe(true);
    expect(data.data.exceptions[0].frames.length).toBeLessThan(50);
    expect(data.data.exceptions[1].frames).toEqual([{function: 'app', inApp: true}]);
    expect(Buffer.byteLength(JSON.stringify(response))).toBeLessThanOrEqual(64 * 1024);
  });

  it('removes oversized source context before stack frames', async () => {
    const {client, call} = setup();
    client.getIssueEvent.mockResolvedValueOnce({
      id: 'event-3',
      groupID: '42',
      entries: [
        {
          type: 'exception',
          data: {
            values: [
              {
                type: 'TypeError',
                stacktrace: {
                  frames: [
                    {function: 'app', inApp: true, context: [[1, 'x'.repeat(40_000)]]},
                    {function: 'library', inApp: false},
                  ],
                },
              },
            ],
          },
        },
      ],
    });
    const {data, response} = await call('get-issue-event', {issueId: '42'});
    expect(data.truncated).toBe(true);
    expect(data.data.exceptions[0].frames).toEqual([
      {function: 'app', inApp: true},
      {function: 'library', inApp: false},
    ]);
    expect(data.data.id).toBe('event-3');
    expect(data.sourceUrl).toContain('/issues/42/');
    expect(Buffer.byteLength(JSON.stringify(response))).toBeLessThanOrEqual(64 * 1024);
  });
});
