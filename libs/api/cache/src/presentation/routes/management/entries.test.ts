import {entryObjectKey, objectStore} from '#api/object-storage.js';
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
import {findEntryRowById, listDeletionReasons} from '#test/queries.js';

describe('cache entries management routes', () => {
  let testApp: ManagementTestApp;

  beforeAll(async () => {
    testApp = await createManagementTestApp();
  });

  afterAll(async () => {
    await testApp.close();
  });

  async function startProjectJob(): Promise<TestJob> {
    const job = await startJob();
    testApp.projectWorkspaces.set(job.projectId, job.workspaceId);
    return job;
  }

  function asMemberOf(job: TestJob) {
    return signIn([{workspaceId: job.workspaceId}]);
  }

  function objectOf(job: TestJob, entryId: string): Promise<unknown> {
    return objectStore().head(
      entryObjectKey({id: entryId, workspaceId: job.workspaceId, projectId: job.projectId}),
    );
  }

  describe('GET /projects/:projectId/cache/scopes', () => {
    it('lists the scopes that hold committed entries with their count, size, and last use', async () => {
      const job = await startProjectJob();
      await saveEntry(testApp.app, job, {scope: 'main', key: 'a', body: archiveOf('1234')});
      await saveEntry(testApp.app, job, {scope: 'main', key: 'b', body: archiveOf('123456')});
      await saveEntry(testApp.app, job, {scope: 'pr-7', key: 'c', body: archiveOf('12')});
      // An upload in flight is not an entry yet.
      await cacheClient(testApp.app, job).reserve({scope: 'pr-8', key: 'd', body: archiveOf('x')});

      const res = await testApp.app.inject({
        method: 'GET',
        url: `/projects/${job.projectId}/cache/scopes`,
        headers: asMemberOf(job),
      });

      const body = expectJson(res, 200);
      expect(body.scopes).toHaveLength(2);
      expect(body.scopes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            scope: 'main',
            entry_count: 2,
            size_bytes: 10,
            dev_sandbox: null,
          }),
          expect.objectContaining({
            scope: 'pr-7',
            entry_count: 1,
            size_bytes: 2,
            dev_sandbox: null,
          }),
        ]),
      );
      expect(Date.parse(body.scopes[0].last_used_at)).not.toBeNaN();
    });

    it('returns a dev sandbox with its user', async () => {
      const job = await startProjectJob();
      await saveDevEntry(job, 'user-1', 'main');

      const res = await testApp.app.inject({
        method: 'GET',
        url: `/projects/${job.projectId}/cache/scopes`,
        headers: asMemberOf(job),
      });

      expect(expectJson(res, 200).scopes).toEqual([
        expect.objectContaining({
          scope: 'dev/user-1/main',
          dev_sandbox: {user_id: 'user-1', scope: 'main'},
        }),
      ]);
    });
  });

  describe('GET /projects/:projectId/cache/entries', () => {
    it('lists committed entries newest first and filters by scope and key prefix', async () => {
      const job = await startProjectJob();
      await saveEntry(testApp.app, job, {scope: 'main', key: 'pnpm-1', body: archiveOf('a')});
      await saveEntry(testApp.app, job, {scope: 'main', key: 'pnpm-2', body: archiveOf('b')});
      await saveEntry(testApp.app, job, {scope: 'main', key: 'cargo-1', body: archiveOf('c')});
      await saveEntry(testApp.app, job, {scope: 'other', key: 'pnpm-3', body: archiveOf('d')});
      const list = (query: string) =>
        testApp.app.inject({
          method: 'GET',
          url: `/projects/${job.projectId}/cache/entries${query}`,
          headers: asMemberOf(job),
        });

      const all = expectJson(await list(''), 200);
      const filtered = expectJson(await list('?scope=main&key_prefix=pnpm-'), 200);

      expect(all.entries.map((entry: {key: string}) => entry.key)).toEqual([
        'pnpm-3',
        'cargo-1',
        'pnpm-2',
        'pnpm-1',
      ]);
      expect(all.next_cursor).toBeNull();
      expect(filtered.entries.map((entry: {key: string}) => entry.key)).toEqual([
        'pnpm-2',
        'pnpm-1',
      ]);
      expect(filtered.entries[0]).toMatchObject({
        scope: 'main',
        size_bytes: 1,
        created_by_run_id: job.workflowRunId,
        dev_sandbox: null,
      });
    });

    it('treats LIKE wildcards in the key prefix literally', async () => {
      const job = await startProjectJob();
      await saveEntry(testApp.app, job, {key: 'a_b', body: archiveOf('1')});
      await saveEntry(testApp.app, job, {key: 'axb', body: archiveOf('2')});

      const res = await testApp.app.inject({
        method: 'GET',
        url: `/projects/${job.projectId}/cache/entries?key_prefix=a_`,
        headers: asMemberOf(job),
      });

      expect(expectJson(res, 200).entries.map((entry: {key: string}) => entry.key)).toEqual([
        'a_b',
      ]);
    });

    it('pages without skipping or repeating an entry', async () => {
      const job = await startProjectJob();
      for (const key of ['k1', 'k2', 'k3', 'k4', 'k5']) {
        await saveEntry(testApp.app, job, {key, body: archiveOf(key)});
      }

      const keys: string[] = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const query: string = cursor ? `?limit=2&cursor=${cursor}` : '?limit=2';
        const res = await testApp.app.inject({
          method: 'GET',
          url: `/projects/${job.projectId}/cache/entries${query}`,
          headers: asMemberOf(job),
        });
        const page = expectJson(res, 200);
        keys.push(...page.entries.map((entry: {key: string}) => entry.key));
        cursor = page.next_cursor;
        pages += 1;
      } while (cursor);

      expect(keys).toEqual(['k5', 'k4', 'k3', 'k2', 'k1']);
      expect(pages).toBe(3);
    });

    it('rejects a cursor that is not one it issued', async () => {
      const job = await startProjectJob();

      const res = await testApp.app.inject({
        method: 'GET',
        url: `/projects/${job.projectId}/cache/entries?cursor=nonsense`,
        headers: asMemberOf(job),
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('invalid-cursor');
    });
  });

  describe('DELETE /projects/:projectId/cache/entries/:entryId', () => {
    it('deletes the row and the object and records a manual deletion', async () => {
      const job = await startProjectJob();
      const entryId = await saveEntry(testApp.app, job, {key: 'doomed', body: archiveOf('x')});
      const keptId = await saveEntry(testApp.app, job, {key: 'kept', body: archiveOf('y')});

      const res = await testApp.app.inject({
        method: 'DELETE',
        url: `/projects/${job.projectId}/cache/entries/${entryId}`,
        headers: asMemberOf(job),
      });

      expect(res.statusCode).toBe(204);
      expect(await findEntryRowById(entryId)).toBeUndefined();
      expect(await objectOf(job, entryId)).toBeNull();
      expect(await findEntryRowById(keptId)).toBeDefined();
      expect(await listDeletionReasons(job.projectId)).toEqual(['manual']);
    });

    it('answers not found for an entry of another project or one that is only uploading', async () => {
      const job = await startProjectJob();
      const other = await startProjectJob();
      const foreignId = await saveEntry(testApp.app, other, {key: 'x', body: archiveOf('x')});
      const reserved = await cacheClient(testApp.app, job).reserve({
        key: 'uploading',
        body: archiveOf('u'),
      });
      const uploadingId = reserved.json().entry_id as string;
      const remove = (entryId: string) =>
        testApp.app.inject({
          method: 'DELETE',
          url: `/projects/${job.projectId}/cache/entries/${entryId}`,
          headers: asMemberOf(job),
        });

      const foreign = await remove(foreignId);
      const uploading = await remove(uploadingId);

      expect(foreign.statusCode).toBe(404);
      expect(foreign.json().code).toBe('entry-not-found');
      expect(uploading.statusCode).toBe(404);
      expect(await findEntryRowById(foreignId)).toBeDefined();
      expect(await findEntryRowById(uploadingId)).toBeDefined();
    });
  });

  describe('DELETE /projects/:projectId/cache/scopes/:scope', () => {
    it('removes every entry of the scope with its objects and leaves the rest', async () => {
      const job = await startProjectJob();
      const doomed = [
        await saveEntry(testApp.app, job, {scope: 'pr-1', key: 'a', body: archiveOf('1234')}),
        await saveEntry(testApp.app, job, {scope: 'pr-1', key: 'b', body: archiveOf('12')}),
      ];
      const kept = await saveEntry(testApp.app, job, {
        scope: 'main',
        key: 'a',
        body: archiveOf('z'),
      });

      const res = await testApp.app.inject({
        method: 'DELETE',
        url: `/projects/${job.projectId}/cache/scopes/pr-1`,
        headers: asMemberOf(job),
      });

      expect(expectJson(res, 200)).toEqual({deleted_count: 2, deleted_bytes: 6});
      for (const entryId of doomed) {
        expect(await findEntryRowById(entryId)).toBeUndefined();
        expect(await objectOf(job, entryId)).toBeNull();
      }
      expect(await findEntryRowById(kept)).toBeDefined();
      expect(await objectOf(job, kept)).not.toBeNull();
      expect(await listDeletionReasons(job.projectId)).toEqual(['manual', 'manual']);
    });

    it('deletes a dev sandbox addressed by its encoded stored scope', async () => {
      const job = await startProjectJob();
      await saveDevEntry(job, 'user-1', 'main');

      const res = await testApp.app.inject({
        method: 'DELETE',
        url: `/projects/${job.projectId}/cache/scopes/${encodeURIComponent('dev/user-1/main')}`,
        headers: asMemberOf(job),
      });

      expect(expectJson(res, 200).deleted_count).toBe(1);
    });

    it('lists and deletes a scope of the longest length, including a long dev sandbox', async () => {
      const job = await startProjectJob();
      const longScope = `pr/${'x'.repeat(125)}`;
      await saveEntry(testApp.app, job, {scope: longScope, key: 'a', body: archiveOf('1')});
      await saveDevEntry(job, crypto.randomUUID(), longScope);

      const scopes = await testApp.app.inject({
        method: 'GET',
        url: `/projects/${job.projectId}/cache/scopes`,
        headers: asMemberOf(job),
      });
      const stored = expectJson(scopes, 200).scopes.map((scope: {scope: string}) => scope.scope);
      const deleted = await Promise.all(
        stored.map((scope: string) =>
          testApp.app.inject({
            method: 'DELETE',
            url: `/projects/${job.projectId}/cache/scopes/${encodeURIComponent(scope)}`,
            headers: asMemberOf(job),
          }),
        ),
      );

      expect(stored).toHaveLength(2);
      expect(deleted.map((res) => expectJson(res, 200).deleted_count)).toEqual([1, 1]);
    });

    it('answers an empty result for a scope with no entries', async () => {
      const job = await startProjectJob();

      const res = await testApp.app.inject({
        method: 'DELETE',
        url: `/projects/${job.projectId}/cache/scopes/nothing-here`,
        headers: asMemberOf(job),
      });

      expect(expectJson(res, 200)).toEqual({deleted_count: 0, deleted_bytes: 0});
    });
  });

  describe('access', () => {
    it('hides a project from members of another workspace', async () => {
      const job = await startProjectJob();
      const entryId = await saveEntry(testApp.app, job, {key: 'secret', body: archiveOf('x')});
      const outsider = signIn([{workspaceId: crypto.randomUUID()}]);
      const requests = [
        {method: 'GET', url: `/projects/${job.projectId}/cache/scopes`},
        {method: 'GET', url: `/projects/${job.projectId}/cache/entries`},
        {method: 'DELETE', url: `/projects/${job.projectId}/cache/entries/${entryId}`},
        {method: 'DELETE', url: `/projects/${job.projectId}/cache/scopes/default`},
      ] as const;

      for (const request of requests) {
        const res = await testApp.app.inject({...request, headers: outsider});

        expect(res.statusCode, `${request.method} ${request.url}`).toBe(404);
        expect(res.json().code).toBe('project-not-found');
      }
      expect(await findEntryRowById(entryId)).toBeDefined();
    });

    it('answers the same 404 for a project that does not exist', async () => {
      const res = await testApp.app.inject({
        method: 'GET',
        url: `/projects/${crypto.randomUUID()}/cache/scopes`,
        headers: signIn([{workspaceId: crypto.randomUUID()}]),
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().code).toBe('project-not-found');
    });

    it('requires a session', async () => {
      const job = await startProjectJob();

      const res = await testApp.app.inject({
        method: 'GET',
        url: `/projects/${job.projectId}/cache/scopes`,
      });

      expect(res.statusCode).toBe(401);
    });

    it('refuses a suspended workspace', async () => {
      const job = await startProjectJob();

      const res = await testApp.app.inject({
        method: 'GET',
        url: `/projects/${job.projectId}/cache/scopes`,
        headers: signIn([{workspaceId: job.workspaceId, workspaceStatus: 'suspended'}]),
      });

      expect(res.statusCode).toBe(409);
    });
  });

  /** Saves from a dev run of `userId` in the same project, which lands in that user's sandbox. */
  async function saveDevEntry(project: TestJob, userId: string, scope: string): Promise<void> {
    const devJob = await startJob({
      workspaceId: project.workspaceId,
      projectId: project.projectId,
    });
    testApp.devRunUsers.set(devJob.workflowRunId, userId);
    await saveEntry(testApp.app, devJob, {scope, key: 'sandboxed', body: archiveOf('dev')});
  }
});
