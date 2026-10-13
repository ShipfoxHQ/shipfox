import {
  deleteCacheEntriesResultSchema,
  getCacheUsageResultSchema,
  listCacheEntriesResultSchema,
} from '@shipfox/api-agent-access-dto';
import type {AgentAccessContext} from '@shipfox/api-auth-context';
import {
  type CacheModuleClient,
  cacheInterModuleContract,
} from '@shipfox/api-cache-dto/inter-module';
import {createInterModuleKnownError} from '@shipfox/inter-module';
import {createAgentAccessCacheTools} from './cache-tools.js';
import type {AgentAccessTool} from './tools.js';

const workspaceId = '00000000-0000-4000-8000-000000000001';
const projectId = '00000000-0000-4000-8000-000000000002';
const entryId = '00000000-0000-4000-8000-000000000003';
const runId = '00000000-0000-4000-8000-000000000004';
const context = {workspaceId} as AgentAccessContext;

function toolNamed(name: string, cache: Partial<CacheModuleClient>): AgentAccessTool {
  const tool = createAgentAccessCacheTools(cache as CacheModuleClient).find(
    (candidate) => candidate.name === name,
  );
  if (!tool) throw new Error(`No tool named ${name}`);
  return tool;
}

function entry(overrides: Record<string, unknown> = {}) {
  return {
    id: entryId,
    scope: 'main',
    devSandbox: null,
    key: 'pnpm-abc',
    sizeBytes: 1024,
    createdAt: '2026-10-13T10:00:00.000Z',
    lastUsedAt: '2026-10-13T11:00:00.000Z',
    createdByRunId: runId,
    cursor: 'cursor-1',
    ...overrides,
  };
}

describe('cache tools', () => {
  test('are two read tools and one destructive action tool', () => {
    const tools = createAgentAccessCacheTools({} as CacheModuleClient);

    expect(tools.map((tool) => [tool.name, tool.annotations.readOnlyHint])).toEqual([
      ['list_cache_entries', true],
      ['get_cache_usage', true],
      ['delete_cache_entries', false],
    ]);
    expect(tools[2]?.annotations.destructiveHint).toBe(true);
  });
});

describe('list_cache_entries', () => {
  test('lists entries for the credential workspace with snake_case fields and a sandbox', async () => {
    const listCacheEntries = vi.fn().mockResolvedValue({
      entries: [
        entry(),
        entry({
          id: '00000000-0000-4000-8000-000000000005',
          scope: 'dev/user-1/main',
          devSandbox: {userId: 'user-1', scope: 'main'},
        }),
      ],
      nextCursor: 'cursor-2',
    });
    const tool = toolNamed('list_cache_entries', {listCacheEntries});

    const response = await tool.execute({
      context,
      arguments: {project_id: projectId, scope: 'main', key_prefix: 'pnpm-', limit: 2},
    });

    expect(listCacheEntries).toHaveBeenCalledWith({
      workspaceId,
      projectId,
      scope: 'main',
      keyPrefix: 'pnpm-',
      limit: 2,
    });
    expect(response.ok).toBe(true);
    const result = listCacheEntriesResultSchema.parse(response.result);
    expect(result.next_cursor).toBe('cursor-2');
    expect(result.entries[0]).toMatchObject({
      key: 'pnpm-abc',
      size_bytes: 1024,
      last_used_at: '2026-10-13T11:00:00.000Z',
      created_by_run_id: runId,
      dev_sandbox: null,
    });
    expect(result.entries[1]?.dev_sandbox).toEqual({user_id: 'user-1', scope: 'main'});
  });

  test('answers not found for a project of another workspace', async () => {
    const listCacheEntries = vi
      .fn()
      .mockRejectedValue(
        createInterModuleKnownError(
          cacheInterModuleContract.methods.listCacheEntries,
          'project-not-found',
          {projectId},
        ),
      );
    const tool = toolNamed('list_cache_entries', {listCacheEntries});

    const response = await tool.execute({context, arguments: {project_id: projectId}});

    expect(response).toMatchObject({ok: false, error: {code: 'not-found'}});
  });

  test('answers an invalid request for a cursor the producer refuses', async () => {
    const listCacheEntries = vi
      .fn()
      .mockRejectedValue(
        createInterModuleKnownError(
          cacheInterModuleContract.methods.listCacheEntries,
          'invalid-cursor',
          {},
        ),
      );
    const tool = toolNamed('list_cache_entries', {listCacheEntries});

    const response = await tool.execute({
      context,
      arguments: {project_id: projectId, cursor: 'nonsense'},
    });

    expect(response).toMatchObject({ok: false, error: {code: 'invalid-request'}});
  });

  test.each([
    {},
    {project_id: 'not-a-uuid'},
    {project_id: projectId, scope: 'has space'},
    {project_id: projectId, limit: 101},
    {project_id: projectId, extra: true},
  ])('rejects the input %j', async (input) => {
    const listCacheEntries = vi.fn();
    const tool = toolNamed('list_cache_entries', {listCacheEntries});

    const response = await tool.execute({context, arguments: input});

    expect(response).toMatchObject({ok: false, error: {code: 'invalid-request'}});
    expect(listCacheEntries).not.toHaveBeenCalled();
  });
});

describe('get_cache_usage', () => {
  test('reports the workspace totals without the deletion history', async () => {
    const getCacheUsage = vi.fn().mockResolvedValue({
      storedBytes: 3000,
      limitBytes: null,
      projects: [{projectId, storedBytes: 3000, entryCount: 2}],
      recentDeletions: [
        {
          projectId,
          scope: 'main',
          key: 'old',
          sizeBytes: 10,
          reason: 'expired',
          deletedAt: '2026-10-13T10:00:00.000Z',
        },
      ],
    });
    const tool = toolNamed('get_cache_usage', {getCacheUsage});

    const response = await tool.execute({context, arguments: {}});

    expect(getCacheUsage).toHaveBeenCalledWith({workspaceId});
    expect(getCacheUsageResultSchema.parse(response.result)).toEqual({
      stored_bytes: 3000,
      limit_bytes: null,
      projects: [{project_id: projectId, stored_bytes: 3000, entry_count: 2}],
    });
  });

  test('rejects an input', async () => {
    const getCacheUsage = vi.fn();
    const tool = toolNamed('get_cache_usage', {getCacheUsage});

    const response = await tool.execute({context, arguments: {workspace_id: workspaceId}});

    expect(response).toMatchObject({ok: false, error: {code: 'invalid-request'}});
    expect(getCacheUsage).not.toHaveBeenCalled();
  });
});

describe('delete_cache_entries', () => {
  test('deletes one entry in the credential workspace', async () => {
    const deleteCacheEntries = vi.fn().mockResolvedValue({deletedCount: 1, deletedBytes: 1024});
    const tool = toolNamed('delete_cache_entries', {deleteCacheEntries});

    const response = await tool.execute({
      context,
      arguments: {project_id: projectId, entry_id: entryId},
    });

    expect(deleteCacheEntries).toHaveBeenCalledWith({
      workspaceId,
      projectId,
      target: {entryId},
    });
    expect(deleteCacheEntriesResultSchema.parse(response.result)).toEqual({
      deleted_count: 1,
      deleted_bytes: 1024,
    });
  });

  test('deletes a whole scope', async () => {
    const deleteCacheEntries = vi.fn().mockResolvedValue({deletedCount: 4, deletedBytes: 4096});
    const tool = toolNamed('delete_cache_entries', {deleteCacheEntries});

    const response = await tool.execute({
      context,
      arguments: {project_id: projectId, scope: 'pr-12'},
    });

    expect(deleteCacheEntries).toHaveBeenCalledWith({
      workspaceId,
      projectId,
      target: {scope: 'pr-12'},
    });
    expect(response).toMatchObject({ok: true, result: {deleted_count: 4}});
  });

  test.each([
    {project_id: projectId},
    {project_id: projectId, entry_id: entryId, scope: 'main'},
    {entry_id: entryId},
  ])('needs exactly one target: rejects %j', async (input) => {
    const deleteCacheEntries = vi.fn();
    const tool = toolNamed('delete_cache_entries', {deleteCacheEntries});

    const response = await tool.execute({context, arguments: input});

    expect(response).toMatchObject({ok: false, error: {code: 'invalid-request'}});
    expect(deleteCacheEntries).not.toHaveBeenCalled();
  });

  test.each([
    'project-not-found',
    'entry-not-found',
  ] as const)('answers not found on %s', async (code) => {
    const deleteCacheEntries = vi
      .fn()
      .mockRejectedValue(
        createInterModuleKnownError(
          cacheInterModuleContract.methods.deleteCacheEntries,
          code,
          code === 'entry-not-found' ? {entryId} : {projectId},
        ),
      );
    const tool = toolNamed('delete_cache_entries', {deleteCacheEntries});

    const response = await tool.execute({
      context,
      arguments: {project_id: projectId, entry_id: entryId},
    });

    expect(response).toMatchObject({ok: false, error: {code: 'not-found'}});
  });
});
