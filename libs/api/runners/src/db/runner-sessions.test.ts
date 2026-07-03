import {and, eq, inArray} from 'drizzle-orm';
import {db} from '#db/db.js';
import {deleteExpiredRunnerSessions} from '#db/runner-sessions.js';
import {runnerSessions} from '#db/schema/runner-sessions.js';
import {runningJobExecutions} from '#db/schema/running-job-executions.js';

describe('deleteExpiredRunnerSessions', () => {
  let workspaceId: string;

  beforeEach(() => {
    workspaceId = crypto.randomUUID();
  });

  it('deletes manual sessions older than the manual retention window', async () => {
    const expired = await insertRunnerSession({kind: 'manual', createdDaysAgo: 31});
    const active = await insertRunnerSession({kind: 'manual', createdDaysAgo: 29});

    const deleted = await deleteExpiredRunnerSessions({
      manualRetentionDays: 30,
      ephemeralRetentionDays: 7,
      limit: 100,
    });

    const remaining = await listRunnerSessionIds([expired, active]);
    expect(deleted).toBeGreaterThanOrEqual(1);
    expect(remaining).toEqual([active]);
  });

  it('deletes ephemeral sessions older than the ephemeral retention window', async () => {
    const expired = await insertRunnerSession({kind: 'ephemeral', createdDaysAgo: 8});
    const active = await insertRunnerSession({kind: 'ephemeral', createdDaysAgo: 6});

    const deleted = await deleteExpiredRunnerSessions({
      manualRetentionDays: 30,
      ephemeralRetentionDays: 7,
      limit: 100,
    });

    const remaining = await listRunnerSessionIds([expired, active]);
    expect(deleted).toBeGreaterThanOrEqual(1);
    expect(remaining).toEqual([active]);
  });

  it('applies the retention window for each registration token kind independently', async () => {
    const manualExpired = await insertRunnerSession({kind: 'manual', createdDaysAgo: 31});
    const manualActive = await insertRunnerSession({kind: 'manual', createdDaysAgo: 8});
    const ephemeralExpired = await insertRunnerSession({kind: 'ephemeral', createdDaysAgo: 8});
    const ephemeralActive = await insertRunnerSession({kind: 'ephemeral', createdDaysAgo: 6});

    await deleteExpiredRunnerSessions({
      manualRetentionDays: 30,
      ephemeralRetentionDays: 7,
      limit: 100,
    });

    const remaining = await listRunnerSessionIds([
      manualExpired,
      manualActive,
      ephemeralExpired,
      ephemeralActive,
    ]);
    expect(remaining).toEqual([manualActive, ephemeralActive]);
  });

  it('keeps expired sessions referenced by running jobs', async () => {
    const expired = await insertRunnerSession({kind: 'manual', createdDaysAgo: 31});
    await insertRunningJob(expired);

    const deleted = await deleteExpiredRunnerSessions({
      manualRetentionDays: 30,
      ephemeralRetentionDays: 7,
      limit: 100,
    });

    const remaining = await listRunnerSessionIds([expired]);
    expect(deleted).toBe(0);
    expect(remaining).toEqual([expired]);
  });

  it('honors the deletion limit', async () => {
    const first = await insertRunnerSession({kind: 'manual', createdDaysAgo: 3652});
    const second = await insertRunnerSession({kind: 'manual', createdDaysAgo: 3651});
    const third = await insertRunnerSession({kind: 'manual', createdDaysAgo: 3650});

    const deleted = await deleteExpiredRunnerSessions({
      manualRetentionDays: 30,
      ephemeralRetentionDays: 7,
      limit: 2,
    });

    const remaining = await listRunnerSessionIds([first, second, third]);
    expect(deleted).toBe(2);
    expect(remaining).toHaveLength(1);
  });

  async function insertRunnerSession(params: {
    kind: 'manual' | 'ephemeral';
    createdDaysAgo: number;
  }): Promise<string> {
    const id = crypto.randomUUID();
    const registrationTokenId = crypto.randomUUID();
    const createdAt = new Date(Date.now() - params.createdDaysAgo * 24 * 60 * 60 * 1000);
    const provisionerId = params.kind === 'ephemeral' ? crypto.randomUUID() : null;
    const provisionedRunnerId =
      params.kind === 'ephemeral' ? `provisioned-${crypto.randomUUID()}` : null;

    await db()
      .insert(runnerSessions)
      .values({
        id,
        workspaceId,
        scope: 'workspace',
        registrationTokenId,
        registrationTokenKind: params.kind,
        provisionerId,
        provisionedRunnerId,
        labels: ['linux'],
        maxClaims: params.kind === 'ephemeral' ? 1 : null,
        claimsUsed: 0,
        createdAt,
        updatedAt: createdAt,
      });

    return id;
  }

  async function insertRunningJob(runnerSessionId: string): Promise<void> {
    await db()
      .insert(runningJobExecutions)
      .values({
        workspaceId,
        workflowRunId: crypto.randomUUID(),
        workflowRunAttemptId: crypto.randomUUID(),
        jobId: crypto.randomUUID(),
        jobExecutionId: crypto.randomUUID(),
        projectId: crypto.randomUUID(),
        runnerSessionId,
        requiredLabels: ['linux'],
        runnerLabels: ['linux'],
      });
  }

  async function listRunnerSessionIds(ids: string[]): Promise<string[]> {
    if (ids.length === 0) return [];

    const rows = await db()
      .select({id: runnerSessions.id})
      .from(runnerSessions)
      .where(and(eq(runnerSessions.workspaceId, workspaceId), inArray(runnerSessions.id, ids)));

    return ids.filter((id) => rows.some((row) => row.id === id));
  }
});
