import {createTestDevRun, createTestRun} from '#test/helpers/workflow-runs.js';
import {updateWorkflowRunStatus} from '../workflow-runs.js';
import {listLatestSyncedWorkflowRuns} from './latest-runs.js';

describe('listLatestSyncedWorkflowRuns', () => {
  let workspaceId: string;
  let projectId: string;

  beforeEach(() => {
    workspaceId = crypto.randomUUID();
    projectId = crypto.randomUUID();
  });

  test('returns the newest synced run of each requested definition', async () => {
    const first = crypto.randomUUID();
    const second = crypto.randomUUID();
    await createTestRun({workspaceId, projectId, definitionId: first});
    const firstNewest = await createTestRun({workspaceId, projectId, definitionId: first});
    const secondOnly = await createTestRun({workspaceId, projectId, definitionId: second});
    await updateWorkflowRunStatus({
      workflowRunId: firstNewest.id,
      status: 'failed',
      expectedVersion: firstNewest.version,
    });

    const runs = await listLatestSyncedWorkflowRuns({
      projectId,
      definitionIds: [first, second],
    });

    expect(runs).toHaveLength(2);
    expect(runs.find((run) => run.definitionId === first)).toMatchObject({
      id: firstNewest.id,
      number: 2,
      status: 'failed',
    });
    expect(runs.find((run) => run.definitionId === second)).toMatchObject({
      id: secondOnly.id,
      number: 1,
    });
  });

  test('skips dev runs, even when they are newer', async () => {
    const definitionId = crypto.randomUUID();
    const synced = await createTestRun({workspaceId, projectId, definitionId});
    await createTestDevRun({workspaceId, projectId, definitionId});

    const runs = await listLatestSyncedWorkflowRuns({projectId, definitionIds: [definitionId]});

    expect(runs.map((run) => run.id)).toEqual([synced.id]);
  });

  test('leaves out a definition that only has dev runs or no runs', async () => {
    const devOnly = crypto.randomUUID();
    const never = crypto.randomUUID();
    await createTestDevRun({workspaceId, projectId, definitionId: devOnly});

    const runs = await listLatestSyncedWorkflowRuns({
      projectId,
      definitionIds: [devOnly, never],
    });

    expect(runs).toEqual([]);
  });

  test('only reads runs of the requested project and definitions', async () => {
    const definitionId = crypto.randomUUID();
    const otherDefinitionId = crypto.randomUUID();
    await createTestRun({workspaceId, projectId: crypto.randomUUID(), definitionId});
    await createTestRun({workspaceId, projectId, definitionId: otherDefinitionId});

    const runs = await listLatestSyncedWorkflowRuns({projectId, definitionIds: [definitionId]});

    expect(runs).toEqual([]);
  });

  test('returns nothing without definitions', async () => {
    await expect(listLatestSyncedWorkflowRuns({projectId, definitionIds: []})).resolves.toEqual([]);
  });
});
