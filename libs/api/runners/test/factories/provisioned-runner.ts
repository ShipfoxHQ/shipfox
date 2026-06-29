import {Factory} from 'fishery';
import type {ProvisionedRunner} from '#core/entities/provisioned-runner.js';
import {db} from '#db/db.js';
import {provisionedRunners} from '#db/schema/provisioned-runners.js';

export const provisionedRunnerFactory = Factory.define<ProvisionedRunner>(({onCreate}) => {
  onCreate(async (provisionedRunner) => {
    const [row] = await db()
      .insert(provisionedRunners)
      .values({
        workspaceId: provisionedRunner.workspaceId,
        provisionerId: provisionedRunner.provisionerId,
        provisionedRunnerId: provisionedRunner.provisionedRunnerId,
        reservationId: provisionedRunner.reservationId,
        templateKey: provisionedRunner.templateKey,
        labels: provisionedRunner.labels,
        state: provisionedRunner.state,
        reason: provisionedRunner.reason,
        runnerSessionId: provisionedRunner.runnerSessionId,
        providerKind: provisionedRunner.providerKind,
        reportedAt: provisionedRunner.reportedAt,
        startedAt: provisionedRunner.startedAt,
        stoppingAt: provisionedRunner.stoppingAt,
        stoppedAt: provisionedRunner.stoppedAt,
        failedAt: provisionedRunner.failedAt,
        terminatedAt: provisionedRunner.terminatedAt,
        reservationReleasedAt: provisionedRunner.reservationReleasedAt,
      })
      .returning();

    if (!row) throw new Error('Insert returned no rows');
    return {
      id: row.id,
      workspaceId: row.workspaceId,
      provisionerId: row.provisionerId,
      provisionedRunnerId: row.provisionedRunnerId,
      reservationId: row.reservationId,
      templateKey: row.templateKey,
      labels: row.labels,
      state: row.state,
      reason: row.reason,
      runnerSessionId: row.runnerSessionId,
      providerKind: row.providerKind,
      reportedAt: row.reportedAt,
      startedAt: row.startedAt,
      stoppingAt: row.stoppingAt,
      stoppedAt: row.stoppedAt,
      failedAt: row.failedAt,
      terminatedAt: row.terminatedAt,
      reservationReleasedAt: row.reservationReleasedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  });

  return {
    id: crypto.randomUUID(),
    workspaceId: crypto.randomUUID(),
    provisionerId: crypto.randomUUID(),
    provisionedRunnerId: crypto.randomUUID(),
    reservationId: null,
    templateKey: 'linux',
    labels: ['linux'],
    state: 'running',
    reason: null,
    runnerSessionId: null,
    providerKind: 'docker',
    reportedAt: new Date(),
    startedAt: null,
    stoppingAt: null,
    stoppedAt: null,
    failedAt: null,
    terminatedAt: null,
    reservationReleasedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
});
