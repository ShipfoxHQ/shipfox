import {and, asc, count, eq, inArray, isNotNull, isNull, notExists, sql} from 'drizzle-orm';
import type {InstallationPlacementPolicy} from '#installation-provisioning.js';
import type {Tx} from './db.js';
import {db} from './db.js';
import {activeStates, terminalStates} from './runner-states.js';
import {capacityHolds} from './schema/capacity-holds.js';
import {pendingJobExecutions} from './schema/pending-job-executions.js';
import {provisionerTokens} from './schema/provisioner-tokens.js';
import {providerRunners} from './schema/runner-instances.js';

export async function insertLaunchCapacityHoldsTx(
  tx: Tx,
  params: {workspaceId: string; reservationId: string; units: readonly number[]},
): Promise<void> {
  if (params.units.length === 0) return;
  await tx.insert(capacityHolds).values(
    params.units.map((units) => ({
      workspaceId: params.workspaceId,
      reservationId: params.reservationId,
      units,
    })),
  );
}

export async function insertRunnerCapacityHoldTx(
  tx: Tx,
  params: {workspaceId: string; runnerInstanceId: string; units: number},
): Promise<boolean> {
  const inserted = await tx
    .insert(capacityHolds)
    .values(params)
    .onConflictDoNothing()
    .returning({id: capacityHolds.id});
  return inserted.length > 0;
}

/** Moves an adopted runner's active hold to the adopting workspace, or creates one when it has none. */
export async function assignRunnerCapacityHoldTx(
  tx: Tx,
  params: {workspaceId: string; runnerInstanceId: string; units: number},
): Promise<void> {
  const moved = await tx
    .update(capacityHolds)
    .set({workspaceId: params.workspaceId, units: params.units, jobExecutionId: null})
    .where(
      and(
        eq(capacityHolds.runnerInstanceId, params.runnerInstanceId),
        isNull(capacityHolds.releasedAt),
      ),
    )
    .returning({id: capacityHolds.id});
  if (moved.length === 0) await insertRunnerCapacityHoldTx(tx, params);
}

/** Binds the oldest unbound hold for a launch reservation to the newly-created runner. */
export async function bindCapacityHoldToRunnerTx(
  tx: Tx,
  params: {reservationId: string; runnerInstanceId: string},
): Promise<boolean> {
  const [hold] = await tx
    .select({id: capacityHolds.id})
    .from(capacityHolds)
    .where(
      and(
        eq(capacityHolds.reservationId, params.reservationId),
        isNull(capacityHolds.runnerInstanceId),
        isNull(capacityHolds.releasedAt),
      ),
    )
    .orderBy(asc(capacityHolds.id))
    .limit(1)
    .for('update', {skipLocked: true});
  if (!hold) return false;
  const updated = await tx
    .update(capacityHolds)
    .set({runnerInstanceId: params.runnerInstanceId})
    .where(and(eq(capacityHolds.id, hold.id), isNull(capacityHolds.releasedAt)))
    .returning({id: capacityHolds.id});
  return updated.length > 0;
}

export async function setCapacityHoldJobExecutionTx(
  tx: Tx,
  params: {runnerInstanceId: string; jobExecutionId: string},
): Promise<boolean> {
  const updated = await tx
    .update(capacityHolds)
    .set({jobExecutionId: params.jobExecutionId})
    .where(
      and(
        eq(capacityHolds.runnerInstanceId, params.runnerInstanceId),
        isNull(capacityHolds.releasedAt),
        isNull(capacityHolds.jobExecutionId),
      ),
    )
    .returning({id: capacityHolds.id});
  return updated.length > 0;
}

export async function releaseUnboundCapacityHoldsForReservationsTx(
  tx: Tx,
  reservationIds: readonly string[],
): Promise<number> {
  if (reservationIds.length === 0) return 0;
  const released = await tx
    .update(capacityHolds)
    .set({releasedAt: sql`now()`, releaseReason: 'reservation-expired'})
    .where(
      and(
        inArray(capacityHolds.reservationId, reservationIds as string[]),
        isNull(capacityHolds.runnerInstanceId),
        isNull(capacityHolds.releasedAt),
      ),
    )
    .returning({id: capacityHolds.id});
  return released.length;
}

export async function releaseCapacityHoldsForRunnerInstancesTx(
  tx: Tx,
  params: (
    | {runnerInstanceIds: readonly string[]}
    | {provisionerId: string; providerRunnerIds: readonly string[]}
  ) & {onReleased?: (createdAt: Date) => void},
): Promise<number> {
  const byInstance = 'runnerInstanceIds' in params;
  if ((byInstance ? params.runnerInstanceIds : params.providerRunnerIds).length === 0) return 0;
  const runnerMatch = byInstance
    ? inArray(providerRunners.id, params.runnerInstanceIds as string[])
    : and(
        eq(providerRunners.provisionerId, params.provisionerId),
        inArray(providerRunners.providerRunnerId, params.providerRunnerIds as string[]),
      );
  const runnerIds = tx
    .select({id: providerRunners.id})
    .from(providerRunners)
    .where(and(runnerMatch, inArray(providerRunners.state, terminalStates)));
  const released = await tx
    .update(capacityHolds)
    .set({releasedAt: sql`now()`, releaseReason: 'runner-terminal'})
    .where(
      and(inArray(capacityHolds.runnerInstanceId, runnerIds), isNull(capacityHolds.releasedAt)),
    )
    .returning({id: capacityHolds.id, createdAt: capacityHolds.createdAt});
  for (const hold of released) params.onReleased?.(hold.createdAt);
  return released.length;
}

export async function sweepTerminalCapacityHolds(
  limit = 1000,
  onReleased?: (createdAt: Date) => void,
): Promise<number> {
  return await db().transaction(async (tx) => {
    const rows = await tx
      .select({runnerInstanceId: capacityHolds.runnerInstanceId})
      .from(capacityHolds)
      .innerJoin(providerRunners, eq(providerRunners.id, capacityHolds.runnerInstanceId))
      .where(and(isNull(capacityHolds.releasedAt), inArray(providerRunners.state, terminalStates)))
      .orderBy(asc(capacityHolds.createdAt))
      .limit(limit);
    return await releaseCapacityHoldsForRunnerInstancesTx(tx, {
      runnerInstanceIds: rows.flatMap((row) =>
        row.runnerInstanceId ? [row.runnerInstanceId] : [],
      ),
      ...(onReleased ? {onReleased} : {}),
    });
  });
}

export async function reconcileCapacityHolds(params: {
  placement?: InstallationPlacementPolicy;
  limit?: number;
  onReleased?: (createdAt: Date) => void;
}): Promise<{reconciled: number; swept: number}> {
  const swept = await sweepTerminalCapacityHolds(params.limit ?? 1000, params.onReleased);
  if (!params.placement) return {reconciled: 0, swept};

  const placement = params.placement;

  const reconciled = await db().transaction(async (tx) => {
    const candidates = await tx
      .select({
        runnerInstanceId: providerRunners.id,
        workspaceId: providerRunners.workspaceId,
        labels: providerRunners.labels,
      })
      .from(providerRunners)
      .innerJoin(provisionerTokens, eq(provisionerTokens.id, providerRunners.provisionerId))
      .where(
        and(
          isNotNull(providerRunners.workspaceId),
          inArray(providerRunners.state, activeStates),
          eq(provisionerTokens.scope, 'installation'),
          notExists(
            tx
              .select({id: capacityHolds.id})
              .from(capacityHolds)
              .where(
                and(
                  eq(capacityHolds.runnerInstanceId, providerRunners.id),
                  isNull(capacityHolds.releasedAt),
                ),
              ),
          ),
        ),
      )
      .orderBy(asc(providerRunners.createdAt))
      .limit(params.limit ?? 1000);

    let inserted = 0;
    for (const candidate of candidates) {
      if (!candidate.workspaceId) continue;
      if (
        await insertRunnerCapacityHoldTx(tx, {
          workspaceId: candidate.workspaceId,
          runnerInstanceId: candidate.runnerInstanceId,
          units: placement.units(candidate.labels),
        })
      )
        inserted += 1;
    }
    return inserted;
  });
  return {reconciled, swept};
}

export async function countUnheldInstallationRunners(): Promise<number> {
  const [row] = await db()
    .select({count: count()})
    .from(providerRunners)
    .innerJoin(provisionerTokens, eq(provisionerTokens.id, providerRunners.provisionerId))
    .where(
      and(
        isNotNull(providerRunners.workspaceId),
        inArray(providerRunners.state, activeStates),
        eq(provisionerTokens.scope, 'installation'),
        notExists(
          db()
            .select({id: capacityHolds.id})
            .from(capacityHolds)
            .where(
              and(
                eq(capacityHolds.runnerInstanceId, providerRunners.id),
                isNull(capacityHolds.releasedAt),
              ),
            ),
        ),
      ),
    );
  return Number(row?.count ?? 0);
}

export interface WorkspaceCapacityUsage {
  workspaceId: string;
  unitsInUse: number;
  queuedForCapacity: number;
}

export async function getWorkspaceCapacityUsage(params: {
  workspaceIds: readonly string[];
}): Promise<WorkspaceCapacityUsage[]> {
  if (params.workspaceIds.length === 0) return [];
  const rows = await db()
    .select({
      workspaceId: capacityHolds.workspaceId,
      unitsInUse: sql<number>`coalesce(sum(${capacityHolds.units}), 0)::int`,
    })
    .from(capacityHolds)
    .where(
      and(
        inArray(capacityHolds.workspaceId, params.workspaceIds as string[]),
        isNull(capacityHolds.releasedAt),
      ),
    )
    .groupBy(capacityHolds.workspaceId);
  const queuedRows = await db()
    .select({workspaceId: pendingJobExecutions.workspaceId, queued: count()})
    .from(pendingJobExecutions)
    .where(inArray(pendingJobExecutions.workspaceId, params.workspaceIds as string[]))
    .groupBy(pendingJobExecutions.workspaceId);
  const queuedByWorkspace = new Map(queuedRows.map((row) => [row.workspaceId, Number(row.queued)]));
  const usageByWorkspace = new Map(
    rows.map((row) => [
      row.workspaceId,
      {
        unitsInUse: Number(row.unitsInUse),
        queuedForCapacity: queuedByWorkspace.get(row.workspaceId) ?? 0,
      },
    ]),
  );
  return params.workspaceIds.map((workspaceId) => ({
    workspaceId,
    ...(usageByWorkspace.get(workspaceId) ?? {
      unitsInUse: 0,
      queuedForCapacity: queuedByWorkspace.get(workspaceId) ?? 0,
    }),
  }));
}
