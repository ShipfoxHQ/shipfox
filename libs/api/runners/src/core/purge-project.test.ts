import {ScopeDeletedError} from '@shipfox/node-drizzle';
import {eq} from 'drizzle-orm';
import {db} from '#db/db.js';
import {recordProjectDeleted} from '#db/deleted-scopes.js';
import {claimPendingJobExecution, enqueueJobExecution} from '#db/job-executions.js';
import {runnersDeletedScopes} from '#db/schema/deleted-scopes.js';
import {pendingJobExecutions} from '#db/schema/pending-job-executions.js';
import {pendingJobFactory} from '#test/factories/pending-job.js';
import {runnerSessionFactory} from '#test/factories/runner-session.js';
import {purgeDeletedProject, purgeUnfinishedDeletedProjects} from './purge-project.js';

async function pendingJobsOf(projectId: string) {
  return await db()
    .select()
    .from(pendingJobExecutions)
    .where(eq(pendingJobExecutions.projectId, projectId));
}

describe('purgeDeletedProject', () => {
  let workspaceId: string;
  let projectId: string;

  beforeEach(() => {
    workspaceId = crypto.randomUUID();
    projectId = crypto.randomUUID();
  });

  it('deletes the pending jobs of the project and marks it purged', async () => {
    await pendingJobFactory.create({workspaceId, projectId});
    await pendingJobFactory.create({workspaceId, projectId});

    const result = await purgeDeletedProject({workspaceId, projectId});

    expect(result).toEqual({remaining: 0});
    expect(await pendingJobsOf(projectId)).toEqual([]);
    const [marker] = await db()
      .select()
      .from(runnersDeletedScopes)
      .where(eq(runnersDeletedScopes.projectId, projectId));
    expect(marker?.purgedAt).toBeInstanceOf(Date);
  });

  it('leaves the pending jobs of other projects and workspaces alone', async () => {
    const otherProjectId = crypto.randomUUID();
    await pendingJobFactory.create({workspaceId, projectId: otherProjectId});
    await pendingJobFactory.create({workspaceId: crypto.randomUUID(), projectId});

    await purgeDeletedProject({workspaceId, projectId});

    expect(await pendingJobsOf(otherProjectId)).toHaveLength(1);
    expect(await pendingJobsOf(projectId)).toHaveLength(1);
  });

  it('reports a running job as remaining and leaves the project unpurged', async () => {
    const runnerSession = await runnerSessionFactory.create({workspaceId});
    await pendingJobFactory.create({workspaceId, projectId, requiredLabels: ['linux']});
    await claimPendingJobExecution({
      workspaceId,
      runnerSessionId: runnerSession.id,
      maxClaims: null,
      sessionLabels: ['linux'],
      runnerSessionLivenessThrottleSeconds: 10,
    });

    const result = await purgeDeletedProject({workspaceId, projectId});

    expect(result).toEqual({remaining: 1});
    const [marker] = await db()
      .select()
      .from(runnersDeletedScopes)
      .where(eq(runnersDeletedScopes.projectId, projectId));
    expect(marker?.purgedAt).toBeNull();
  });

  it('refuses a job queued after the purge, and queues jobs of other projects', async () => {
    await purgeDeletedProject({workspaceId, projectId});
    const queue = (scopeProjectId: string) =>
      enqueueJobExecution({
        workspaceId,
        workflowRunId: crypto.randomUUID(),
        workflowRunAttemptId: crypto.randomUUID(),
        jobId: crypto.randomUUID(),
        jobExecutionId: crypto.randomUUID(),
        projectId: scopeProjectId,
        requiredLabels: ['linux'],
        queuedAt: new Date(),
      });
    const otherProjectId = crypto.randomUUID();

    await expect(queue(projectId)).rejects.toBeInstanceOf(ScopeDeletedError);
    await queue(otherProjectId);

    expect(await pendingJobsOf(projectId)).toEqual([]);
    expect(await pendingJobsOf(otherProjectId)).toHaveLength(1);
  });
});

describe('purgeUnfinishedDeletedProjects', () => {
  let workspaceId: string;
  let projectId: string;

  beforeEach(() => {
    workspaceId = crypto.randomUUID();
    projectId = crypto.randomUUID();
  });

  async function purgedAtOf(scopeProjectId: string) {
    const [marker] = await db()
      .select()
      .from(runnersDeletedScopes)
      .where(eq(runnersDeletedScopes.projectId, scopeProjectId));
    return marker?.purgedAt;
  }

  it('finishes the purge of a marked project that still has pending jobs', async () => {
    await pendingJobFactory.create({workspaceId, projectId});
    await recordProjectDeleted({workspaceId, projectId}, 'project_deleted');

    const result = await purgeUnfinishedDeletedProjects();

    expect(result.purged).toBeGreaterThanOrEqual(1);
    expect(await pendingJobsOf(projectId)).toEqual([]);
    expect(await purgedAtOf(projectId)).toBeInstanceOf(Date);
  });

  it('leaves the pending jobs of a project that was never marked', async () => {
    await pendingJobFactory.create({workspaceId, projectId});

    await purgeUnfinishedDeletedProjects();

    expect(await pendingJobsOf(projectId)).toHaveLength(1);
    await db().delete(pendingJobExecutions).where(eq(pendingJobExecutions.projectId, projectId));
  });

  it('does not purge a project again once it is purged', async () => {
    await purgeDeletedProject({workspaceId, projectId});
    const purgedAt = await purgedAtOf(projectId);

    await purgeUnfinishedDeletedProjects();

    expect(await purgedAtOf(projectId)).toEqual(purgedAt);
  });
});
