import {vi} from '@shipfox/vitest/vi';
import {and, eq, isNull} from 'drizzle-orm';
import {db} from '#db/db.js';
import {pollInstallationDemandAndReserve} from '#db/reservations.js';
import {capacityHolds} from '#db/schema/capacity-holds.js';
import {expiredJobExecutions} from '#db/schema/expired-job-executions.js';
import {runnersOutbox} from '#db/schema/outbox.js';
import {pendingJobExecutions} from '#db/schema/pending-job-executions.js';
import {runnerControlSessions} from '#db/schema/runner-control-sessions.js';
import {providerRunners} from '#db/schema/runner-instances.js';
import type {
  InstallationPlacementPolicy,
  WorkspacePlacementRules,
} from '#installation-provisioning.js';
import {placementResolveErrorCount} from '#metrics/instance.js';
import {pendingJobFactory} from '#test/index.js';

const DENIED_EVENT = 'runners.job_execution.placement_denied';
const notice = {
  reason: 'machine-not-allowed',
  message: 'This workspace cannot use 16 vCPU runners.',
  requiredAction: {reason: 'add-credits', message: 'Add credits', url: '/settings/billing'},
};

describe('installation placement rules', () => {
  let workspaceId: string;
  let provisionerId: string;

  beforeEach(() => {
    workspaceId = crypto.randomUUID();
    provisionerId = crypto.randomUUID();
  });

  it('denies a group with a reserved label when every matching template is refused', async () => {
    const job = await pendingJobFactory.create({
      workspaceId,
      requiredLabels: ['shipfox-managed'],
    });

    const result = await poll({templates: [template('shipfox-16cpu', 16, 5)]});

    expect(result.reservations).toEqual([]);
    expect(await pendingJobsFor(workspaceId)).toEqual([]);
    expect(await tombstoneExists(job.jobExecutionId)).toBe(true);
    expect(await deniedEvents(workspaceId)).toEqual([
      {
        workspaceId,
        workflowRunId: job.workflowRunId,
        workflowRunAttemptId: job.workflowRunAttemptId,
        jobId: job.jobId,
        jobExecutionId: job.jobExecutionId,
        notice,
      },
    ]);
  });

  it('denies every queued execution of the refused group and leaves other groups alone', async () => {
    await pendingJobFactory.create({workspaceId, requiredLabels: ['shipfox-managed', 'cpu.16']});
    await pendingJobFactory.create({workspaceId, requiredLabels: ['shipfox-managed', 'cpu.16']});
    const allowed = await pendingJobFactory.create({
      workspaceId,
      requiredLabels: ['shipfox-managed', 'cpu.1'],
    });

    await poll({templates: [template('shipfox-16cpu', 16, 5), template('shipfox-1cpu', 1, 5)]});

    expect(await deniedEvents(workspaceId)).toHaveLength(2);
    expect(await pendingJobsFor(workspaceId)).toEqual([allowed.jobExecutionId]);
  });

  it('skips a refused group without a reserved label', async () => {
    const job = await pendingJobFactory.create({workspaceId, requiredLabels: ['cpu.16']});

    const result = await poll({templates: [template('big', 16, 5, ['cpu.16'])]});

    expect(result.reservations).toEqual([]);
    expect(await pendingJobsFor(workspaceId)).toEqual([job.jobExecutionId]);
    expect(await deniedEvents(workspaceId)).toEqual([]);
  });

  it('does not deny a group that no advertised template matches', async () => {
    const job = await pendingJobFactory.create({
      workspaceId,
      requiredLabels: ['shipfox-managed', 'cpu.64'],
    });

    await poll({templates: [template('shipfox-16cpu', 16, 5)]});

    expect(await pendingJobsFor(workspaceId)).toEqual([job.jobExecutionId]);
    expect(await deniedEvents(workspaceId)).toEqual([]);
  });

  it('denies a refused group behind a group waiting for template slots', async () => {
    const waiting = await pendingJobFactory.create({
      workspaceId,
      requiredLabels: ['shipfox-managed', 'cpu.1'],
    });
    await pendingJobFactory.create({workspaceId, requiredLabels: ['shipfox-managed', 'cpu.16']});

    const result = await poll({
      templates: [template('shipfox-16cpu', 16, 5), template('shipfox-1cpu', 1, 0)],
    });

    expect(result.reservations).toEqual([]);
    expect(await deniedEvents(workspaceId)).toHaveLength(1);
    expect(await pendingJobsFor(workspaceId)).toEqual([waiting.jobExecutionId]);
  });

  it('denies a refused group even when the poll has no grants left', async () => {
    await pendingJobFactory.create({workspaceId, requiredLabels: ['shipfox-managed', 'cpu.16']});

    await poll({maxReservations: 0, templates: [template('shipfox-16cpu', 16, 5)]});

    expect(await deniedEvents(workspaceId)).toHaveLength(1);
  });

  it('skips every candidate workspace when placement rules fail to resolve', async () => {
    const job = await pendingJobFactory.create({
      workspaceId,
      requiredLabels: ['shipfox-managed', 'cpu.16'],
    });
    const errorCount = vi.spyOn(placementResolveErrorCount, 'add');

    const result = await poll({
      placement: placement({
        resolve: () => Promise.reject(new Error('cache unavailable')),
      }),
      templates: [template('shipfox-1cpu', 1, 5), template('shipfox-16cpu', 16, 5)],
    });

    expect(result).toEqual({stats: [], reservations: []});
    expect(errorCount).toHaveBeenCalledTimes(1);
    expect(await pendingJobsFor(workspaceId)).toEqual([job.jobExecutionId]);
    expect(await deniedEvents(workspaceId)).toEqual([]);
  });

  it('keeps today order among allowed templates for an unsized job', async () => {
    const openWorkspaceId = crypto.randomUUID();
    await pendingJobFactory.create({workspaceId, requiredLabels: ['shipfox-managed']});
    await pendingJobFactory.create({
      workspaceId: openWorkspaceId,
      requiredLabels: ['shipfox-managed'],
    });

    const result = await poll({
      eligibleWorkspaceIds: [workspaceId, openWorkspaceId],
      templates: [template('shipfox-1cpu', 1, 5), template('shipfox-16cpu', 16, 5)],
    });

    expect(result.reservations).toHaveLength(2);
    expect(await holdUnits(openWorkspaceId)).toEqual([16]);
    expect(await holdUnits(workspaceId)).toEqual([1]);
    expect(await deniedEvents(workspaceId)).toEqual([]);
  });

  it('does not adopt an idle runner of a refused template, even with extra labels', async () => {
    await pendingJobFactory.create({workspaceId, requiredLabels: ['shipfox-managed']});
    const idle = await createIdleRunner(['cpu.16', 'shipfox-managed', 'x64']);

    const result = await poll({
      templates: [template('shipfox-1cpu', 1, 5), template('shipfox-16cpu', 16, 5)],
    });

    const [stored] = await db().select().from(providerRunners).where(eq(providerRunners.id, idle));
    expect(stored?.workspaceId).toBeNull();
    expect(result.reservations).toEqual([expect.objectContaining({count: 1})]);
  });

  function rulesRefusing16(): WorkspacePlacementRules {
    return {
      allowsTemplate: (labels) => !labels.includes('cpu.16'),
      denial: () => notice,
    };
  }

  function placement(overrides: Partial<InstallationPlacementPolicy> = {}) {
    return {
      units: (labels: readonly string[]) =>
        Number(labels.find((label) => label.startsWith('cpu.'))?.slice(4) ?? 1),
      holds: 'record',
      templateOrder: 'default',
      resolve: async () => new Map([[workspaceId, rulesRefusing16()]]),
      ...overrides,
    } satisfies InstallationPlacementPolicy;
  }

  async function poll(params: {
    templates: ReturnType<typeof template>[];
    maxReservations?: number;
    eligibleWorkspaceIds?: string[];
    placement?: InstallationPlacementPolicy;
  }) {
    return await pollInstallationDemandAndReserve({
      provisionerId,
      maxReservations: params.maxReservations ?? 5,
      ttlSeconds: 60,
      templates: params.templates,
      capabilityWindowSeconds: 60,
      eligibleWorkspaceIds: new Set(params.eligibleWorkspaceIds ?? [workspaceId]),
      placement: params.placement ?? placement(),
    });
  }

  function template(templateKey: string, cpu: number, availableSlots: number, labels?: string[]) {
    return {
      templateKey,
      labels: labels ?? [`cpu.${cpu}`, 'shipfox-managed'],
      availableSlots,
      starting: 0,
      running: 0,
    };
  }

  async function createIdleRunner(labels: string[]): Promise<string> {
    const [runner] = await db()
      .insert(providerRunners)
      .values({
        provisionerId,
        providerRunnerId: crypto.randomUUID(),
        launchKind: 'warm',
        labels,
        state: 'running',
        reportedAt: new Date(),
      })
      .returning({id: providerRunners.id});
    if (!runner) throw new Error('Expected runner instance');
    await db()
      .insert(runnerControlSessions)
      .values({
        runnerInstanceId: runner.id,
        provisionerId,
        hashedToken: crypto.randomUUID(),
        prefix: 'test',
        expiresAt: new Date(Date.now() + 60_000),
      });
    return runner.id;
  }
});

async function pendingJobsFor(workspaceId: string): Promise<string[]> {
  const rows = await db()
    .select({jobExecutionId: pendingJobExecutions.jobExecutionId})
    .from(pendingJobExecutions)
    .where(eq(pendingJobExecutions.workspaceId, workspaceId));
  return rows.map((row) => row.jobExecutionId);
}

async function tombstoneExists(jobExecutionId: string): Promise<boolean> {
  const rows = await db()
    .select()
    .from(expiredJobExecutions)
    .where(eq(expiredJobExecutions.jobExecutionId, jobExecutionId));
  return rows.length === 1;
}

async function deniedEvents(workspaceId: string): Promise<unknown[]> {
  const rows = await db()
    .select()
    .from(runnersOutbox)
    .where(eq(runnersOutbox.eventType, DENIED_EVENT));
  return rows
    .map((row) => row.payload)
    .filter((payload) => (payload as {workspaceId?: string}).workspaceId === workspaceId);
}

async function holdUnits(workspaceId: string): Promise<number[]> {
  const rows = await db()
    .select({units: capacityHolds.units})
    .from(capacityHolds)
    .where(and(eq(capacityHolds.workspaceId, workspaceId), isNull(capacityHolds.releasedAt)));
  return rows.map((row) => row.units);
}
