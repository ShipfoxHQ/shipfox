import {eq} from 'drizzle-orm';
import {db} from '#db/db.js';
import {recordProjectDeleted} from '#db/deleted-scopes.js';
import {workflowsDeletedScopes} from '#db/schema/deleted-scopes.js';
import {workflowConcurrencyClaims} from '#db/schema/workflow-concurrency-claims.js';
import {workflowRunAttempts} from '#db/schema/workflow-run-attempts.js';
import {
  createRerunWorkflowRun,
  createWorkflowRun,
  getWorkflowRunById,
  updateWorkflowRunStatus,
} from '#db/workflow-runs.js';
import {buildModel} from '#test/helpers/workflow-runs.js';
import {workflowRunFactory} from '#test/index.js';
import {ProjectDeletedError} from './errors.js';
import {purgeDeletedProject} from './purge-project.js';

async function deletedScope(scope: {workspaceId: string; projectId: string}) {
  const [row] = await db()
    .select()
    .from(workflowsDeletedScopes)
    .where(eq(workflowsDeletedScopes.projectId, scope.projectId));
  return row;
}

describe('purgeDeletedProject', () => {
  let workspaceId: string;
  let projectId: string;

  beforeEach(() => {
    workspaceId = crypto.randomUUID();
    projectId = crypto.randomUUID();
  });

  test('deletes the runs of the project with their children, and marks the project purged', async () => {
    const pending = await workflowRunFactory.create({workspaceId, projectId});
    const failed = await workflowRunFactory.create({workspaceId, projectId});
    await updateWorkflowRunStatus({
      workflowRunId: failed.id,
      status: 'failed',
      expectedVersion: failed.version,
    });

    const result = await purgeDeletedProject({workspaceId, projectId});

    expect(result).toEqual({remaining: 0});
    expect(await getWorkflowRunById(pending.id)).toBeUndefined();
    expect(await getWorkflowRunById(failed.id)).toBeUndefined();
    expect(
      await db()
        .select()
        .from(workflowRunAttempts)
        .where(eq(workflowRunAttempts.workflowRunId, pending.id)),
    ).toEqual([]);
    expect(
      await db()
        .select()
        .from(workflowConcurrencyClaims)
        .where(eq(workflowConcurrencyClaims.workflowRunId, pending.id)),
    ).toEqual([]);
    expect((await deletedScope({workspaceId, projectId}))?.purgedAt).toBeInstanceOf(Date);
  });

  test('leaves the runs of other projects and workspaces alone', async () => {
    const otherProject = await workflowRunFactory.create({
      workspaceId,
      projectId: crypto.randomUUID(),
    });
    const otherWorkspace = await workflowRunFactory.create({
      workspaceId: crypto.randomUUID(),
      projectId,
    });

    await purgeDeletedProject({workspaceId, projectId});

    expect(await getWorkflowRunById(otherProject.id)).toBeDefined();
    expect(await getWorkflowRunById(otherWorkspace.id)).toBeDefined();
  });

  test('is idempotent and keeps the first marker', async () => {
    await workflowRunFactory.create({workspaceId, projectId});

    await purgeDeletedProject({workspaceId, projectId});
    const first = await deletedScope({workspaceId, projectId});
    const second = await purgeDeletedProject({workspaceId, projectId});

    expect(second).toEqual({remaining: 0});
    expect((await deletedScope({workspaceId, projectId}))?.recordedAt).toEqual(first?.recordedAt);
  });

  test('refuses a run created after the purge', async () => {
    await purgeDeletedProject({workspaceId, projectId});

    const create = createWorkflowRun({
      workspaceId,
      projectId,
      definitionId: crypto.randomUUID(),
      model: buildModel(),
      triggerPayload: {source: 'cron', event: 'tick'},
    });

    await expect(create).rejects.toBeInstanceOf(ProjectDeletedError);
  });

  test('refuses a rerun after the project was marked deleted', async () => {
    const run = await workflowRunFactory.create({workspaceId, projectId});
    await updateWorkflowRunStatus({
      workflowRunId: run.id,
      status: 'failed',
      expectedVersion: run.version,
    });
    await recordProjectDeleted({workspaceId, projectId}, 'project_deleted');

    const rerun = createRerunWorkflowRun({
      workflowRunId: run.id,
      mode: 'all',
      actorUserId: crypto.randomUUID(),
    });

    await expect(rerun).rejects.toBeInstanceOf(ProjectDeletedError);
  });

  test('still creates runs for other projects of the workspace', async () => {
    await purgeDeletedProject({workspaceId, projectId});

    const run = await createWorkflowRun({
      workspaceId,
      projectId: crypto.randomUUID(),
      definitionId: crypto.randomUUID(),
      model: buildModel(),
      triggerPayload: {source: 'cron', event: 'tick'},
    });

    expect(run.status).toBe('pending');
  });
});
