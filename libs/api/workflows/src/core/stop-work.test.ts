import {eq} from 'drizzle-orm';
import {db} from '#db/db.js';
import {deliverEventToListener} from '#db/job-listener-events.js';
import {jobListenerEvents} from '#db/schema/job-listener-events.js';
import {jobs} from '#db/schema/jobs.js';
import {
  getJobsByWorkflowRunId,
  getWorkflowRunById,
  updateWorkflowRunStatus,
} from '#db/workflow-runs.js';
import {workflowRunFactory} from '#test/index.js';
import {stopWork} from './stop-work.js';

async function openRun(scope: {workspaceId: string; projectId: string}) {
  return await workflowRunFactory.create(scope);
}

async function runStatus(runId: string) {
  return (await getWorkflowRunById(runId))?.status;
}

describe('stopWork', () => {
  let workspaceId: string;
  let projectId: string;

  beforeEach(() => {
    workspaceId = crypto.randomUUID();
    projectId = crypto.randomUUID();
  });

  test('cancels the open runs of the project and reports none remaining', async () => {
    const pending = await openRun({workspaceId, projectId});
    const running = await openRun({workspaceId, projectId});
    await updateWorkflowRunStatus({
      workflowRunId: running.id,
      status: 'running',
      expectedVersion: running.version,
    });

    const result = await stopWork({scope: {workspaceId, projectId}, reason: 'project_deleted'});

    expect(result).toEqual({remaining: 0});
    expect(await runStatus(pending.id)).toBe('cancelled');
    expect(await runStatus(running.id)).toBe('cancelled');
  });

  test('leaves finished runs and the runs of other projects alone', async () => {
    const failed = await openRun({workspaceId, projectId});
    await updateWorkflowRunStatus({
      workflowRunId: failed.id,
      status: 'failed',
      expectedVersion: failed.version,
    });
    const otherProject = await openRun({workspaceId, projectId: crypto.randomUUID()});
    const otherWorkspace = await openRun({
      workspaceId: crypto.randomUUID(),
      projectId,
    });

    await stopWork({scope: {workspaceId, projectId}, reason: 'project_deleted'});

    expect(await runStatus(failed.id)).toBe('failed');
    expect(await runStatus(otherProject.id)).toBe('pending');
    expect(await runStatus(otherWorkspace.id)).toBe('pending');
  });

  test('stops every project of the workspace when the scope has no project', async () => {
    const first = await openRun({workspaceId, projectId});
    const second = await openRun({workspaceId, projectId: crypto.randomUUID()});

    const result = await stopWork({scope: {workspaceId}, reason: 'workspace_suspended'});

    expect(result).toEqual({remaining: 0});
    expect(await runStatus(first.id)).toBe('cancelled');
    expect(await runStatus(second.id)).toBe('cancelled');
  });

  test('is safe to repeat', async () => {
    await openRun({workspaceId, projectId});
    const scope = {workspaceId, projectId};

    await stopWork({scope, reason: 'project_deleted'});
    const repeat = await stopWork({scope, reason: 'project_deleted'});

    expect(repeat).toEqual({remaining: 0});
  });

  test('cancels a run whose listening job still waits, and abandons its buffered events', async () => {
    const run = await openRun({workspaceId, projectId});
    await updateWorkflowRunStatus({
      workflowRunId: run.id,
      status: 'running',
      expectedVersion: run.version,
    });
    const [job] = await getJobsByWorkflowRunId(run.id);
    if (!job) throw new Error('Expected a job');
    await db()
      .update(jobs)
      .set({mode: 'listening', listenerStatus: 'listening'})
      .where(eq(jobs.id, job.id));
    await deliverEventToListener({
      jobId: job.id,
      disposition: 'fire',
      eventRef: crypto.randomUUID(),
      deliveryId: crypto.randomUUID(),
      source: 'github',
      event: 'pull_request',
      provider: 'github',
      payload: {action: 'opened'},
      receivedAt: new Date('2026-01-01T00:00:00.000Z'),
    });

    await stopWork({scope: {workspaceId, projectId}, reason: 'project_deleted'});

    expect(await runStatus(run.id)).toBe('cancelled');
    const [event] = await db()
      .select()
      .from(jobListenerEvents)
      .where(eq(jobListenerEvents.jobId, job.id));
    expect(event).toMatchObject({outcome: 'abandoned', outcomeReason: 'cancelled'});
  });
});
