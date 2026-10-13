import {config} from '#config.js';
import {
  archiveOf,
  cacheClient,
  saveEntry,
  startJob,
  type TestJob,
} from '#test/fixtures/cache-api.js';
import {
  createManagementTestApp,
  expectJson,
  type ManagementTestApp,
  signIn,
} from '#test/fixtures/management-api.js';
import {findWorkspaceRetention} from '#test/queries.js';

describe('cache usage and settings routes', () => {
  let testApp: ManagementTestApp;
  let maxStoredBytes: number | null;

  beforeAll(async () => {
    testApp = await createManagementTestApp({
      storagePolicy: {resolve: () => Promise.resolve({maxStoredBytes})},
    });
  });

  afterAll(async () => {
    await testApp.close();
  });

  beforeEach(() => {
    maxStoredBytes = null;
  });

  function startJobIn(workspaceId: string): Promise<TestJob> {
    return startJob({workspaceId});
  }

  describe('GET /workspaces/:workspaceId/cache/usage', () => {
    it('reports live stored bytes, the limit, project totals, and recent deletions', async () => {
      // The module caches a resolved limit, so it is set before the first save.
      maxStoredBytes = 1000;
      const workspaceId = crypto.randomUUID();
      const big = await startJobIn(workspaceId);
      const small = await startJobIn(workspaceId);
      await saveEntry(testApp.app, big, {key: 'a', body: archiveOf('1234567890')});
      await saveEntry(testApp.app, big, {key: 'b', body: archiveOf('12345')});
      await saveEntry(testApp.app, small, {key: 'c', body: archiveOf('123')});
      const doomed = await saveEntry(testApp.app, small, {key: 'd', body: archiveOf('1234')});
      // An upload in flight is not stored yet.
      await cacheClient(testApp.app, small).reserve({key: 'e', body: archiveOf('pending')});
      const headers = signIn([{workspaceId}]);
      testApp.projectWorkspaces.set(small.projectId, workspaceId);
      await testApp.app.inject({
        method: 'DELETE',
        url: `/projects/${small.projectId}/cache/entries/${doomed}`,
        headers,
      });

      const res = await testApp.app.inject({
        method: 'GET',
        url: `/workspaces/${workspaceId}/cache/usage`,
        headers,
      });

      const body = expectJson(res, 200);
      expect(body.stored_bytes).toBe(18);
      expect(body.limit_bytes).toBe(1000);
      expect(body.projects).toEqual([
        {project_id: big.projectId, stored_bytes: 15, entry_count: 2},
        {project_id: small.projectId, stored_bytes: 3, entry_count: 1},
      ]);
      expect(body.recent_deletions).toEqual([
        expect.objectContaining({
          project_id: small.projectId,
          scope: 'default',
          key: 'd',
          size_bytes: 4,
          reason: 'manual',
        }),
      ]);
    });

    it('answers no limit and no entries for a workspace without a cache', async () => {
      const workspaceId = crypto.randomUUID();

      const res = await testApp.app.inject({
        method: 'GET',
        url: `/workspaces/${workspaceId}/cache/usage`,
        headers: signIn([{workspaceId}]),
      });

      expect(expectJson(res, 200)).toEqual({
        stored_bytes: 0,
        limit_bytes: null,
        projects: [],
        recent_deletions: [],
      });
    });

    it('does not count or show the entries of another workspace', async () => {
      const workspaceId = crypto.randomUUID();
      const other = await startJobIn(crypto.randomUUID());
      await saveEntry(testApp.app, other, {key: 'x', body: archiveOf('other workspace')});

      const res = await testApp.app.inject({
        method: 'GET',
        url: `/workspaces/${workspaceId}/cache/usage`,
        headers: signIn([{workspaceId}]),
      });

      expect(expectJson(res, 200).stored_bytes).toBe(0);
    });

    it('refuses a member of another workspace', async () => {
      const res = await testApp.app.inject({
        method: 'GET',
        url: `/workspaces/${crypto.randomUUID()}/cache/usage`,
        headers: signIn([{workspaceId: crypto.randomUUID()}]),
      });

      expect(res.statusCode).toBe(403);
    });
  });

  describe('GET and PUT /workspaces/:workspaceId/cache/settings', () => {
    it('reads the default retention of a workspace that never set one', async () => {
      const workspaceId = crypto.randomUUID();

      const res = await testApp.app.inject({
        method: 'GET',
        url: `/workspaces/${workspaceId}/cache/settings`,
        headers: signIn([{workspaceId}]),
      });

      expect(expectJson(res, 200)).toEqual({
        retention_days: config.CACHE_DEFAULT_RETENTION_DAYS,
        default_retention_days: config.CACHE_DEFAULT_RETENTION_DAYS,
        max_retention_days: config.CACHE_MAX_RETENTION_DAYS,
      });
    });

    it('lets an admin set the retention, and reads it back, again after a change', async () => {
      const workspaceId = crypto.randomUUID();
      const headers = signIn([{workspaceId}]);
      const put = (retention_days: number) =>
        testApp.app.inject({
          method: 'PUT',
          url: `/workspaces/${workspaceId}/cache/settings`,
          headers,
          payload: {retention_days},
        });

      const first = await put(30);
      const second = await put(1);
      const read = await testApp.app.inject({
        method: 'GET',
        url: `/workspaces/${workspaceId}/cache/settings`,
        headers,
      });

      expect(expectJson(first, 200).retention_days).toBe(30);
      expect(expectJson(second, 200).retention_days).toBe(1);
      expect(expectJson(read, 200).retention_days).toBe(1);
      expect(await findWorkspaceRetention(workspaceId)).toBe(1);
    });

    it.each([
      0,
      -3,
      1.5,
      config.CACHE_MAX_RETENTION_DAYS + 1,
    ])('rejects a retention of %s days', async (retentionDays) => {
      const workspaceId = crypto.randomUUID();

      const res = await testApp.app.inject({
        method: 'PUT',
        url: `/workspaces/${workspaceId}/cache/settings`,
        headers: signIn([{workspaceId}]),
        payload: {retention_days: retentionDays},
      });

      expect(res.statusCode).toBe(400);
      expect(await findWorkspaceRetention(workspaceId)).toBeUndefined();
    });

    it('does not let a member who is not an admin change the retention', async () => {
      const workspaceId = crypto.randomUUID();
      const headers = signIn([{workspaceId, role: 'member'}]);

      const put = await testApp.app.inject({
        method: 'PUT',
        url: `/workspaces/${workspaceId}/cache/settings`,
        headers,
        payload: {retention_days: 30},
      });
      const read = await testApp.app.inject({
        method: 'GET',
        url: `/workspaces/${workspaceId}/cache/settings`,
        headers,
      });

      expect(put.statusCode).toBe(403);
      expect(await findWorkspaceRetention(workspaceId)).toBeUndefined();
      expect(read.statusCode).toBe(200);
    });

    it('gives a member of another workspace no access to either route', async () => {
      const workspaceId = crypto.randomUUID();
      const outsider = signIn([{workspaceId: crypto.randomUUID()}]);

      const put = await testApp.app.inject({
        method: 'PUT',
        url: `/workspaces/${workspaceId}/cache/settings`,
        headers: outsider,
        payload: {retention_days: 30},
      });
      const read = await testApp.app.inject({
        method: 'GET',
        url: `/workspaces/${workspaceId}/cache/settings`,
        headers: outsider,
      });

      expect(put.statusCode).toBe(403);
      expect(read.statusCode).toBe(403);
      expect(await findWorkspaceRetention(workspaceId)).toBeUndefined();
    });
  });
});
