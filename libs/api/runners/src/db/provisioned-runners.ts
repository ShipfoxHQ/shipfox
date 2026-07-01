import {logger} from '@shipfox/node-opentelemetry';
import {canonicalizeLabels} from '@shipfox/runner-labels';
import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lt,
  notExists,
  notInArray,
  or,
  type SQL,
  sql,
} from 'drizzle-orm';
import {alias} from 'drizzle-orm/pg-core';
import type {ProvisionedRunner, ProvisionedRunnerState} from '#core/entities/provisioned-runner.js';
import type {Tx} from './db.js';
import {db} from './db.js';
import {
  listRunningJobExecutionsByProvisionedRunnerTx,
  type ProvisionedRunnerBoundJobExecution,
} from './job-executions.js';
import {releaseReservationUnits} from './reservations.js';
import {provisionedRunners, toProvisionedRunner} from './schema/provisioned-runners.js';
import {runningJobExecutions} from './schema/running-job-executions.js';

export const terminalStates = [
  'stopped',
  'failed',
  'terminated',
] as const satisfies readonly ProvisionedRunnerState[];
export const activeStates = [
  'starting',
  'running',
  'stopping',
] as const satisfies readonly ProvisionedRunnerState[];

export interface ProvisionedRunnerReportEvent {
  provisionedRunnerId: string;
  reservationId: string | null;
  templateKey: string | null;
  labels: string[];
  state: ProvisionedRunnerState;
  reason: string | null;
  runnerSessionId: string | null;
  providerKind: string | null;
  reportedAt: Date;
}

export interface ReportProvisionedRunnersParams {
  workspaceId: string;
  provisionerId: string;
  events: ProvisionedRunnerReportEvent[];
}

export interface ReconcileProvisionedRunnersParams {
  workspaceId: string;
  provisionerId: string;
  observedProvisionedRunnerIds: string[];
  terminateGraceSeconds: number;
}

export interface ReconcileProvisionedRunnersDbResult {
  observedRows: ProvisionedRunner[];
  boundJobExecutionsByProvisionedRunnerId: Map<string, ProvisionedRunnerBoundJobExecution>;
  absentIds: string[];
  reservationsReleased: number;
}

interface ProvisionedRunnerReportRow extends ProvisionedRunnerReportEvent {
  startedAt: Date | null;
  stoppingAt: Date | null;
  stoppedAt: Date | null;
  failedAt: Date | null;
  terminatedAt: Date | null;
}

type ProvisionedRunnerMilestoneColumn =
  | typeof provisionedRunners.startedAt
  | typeof provisionedRunners.stoppingAt
  | typeof provisionedRunners.stoppedAt
  | typeof provisionedRunners.failedAt
  | typeof provisionedRunners.terminatedAt;

export async function reportProvisionedRunners(params: ReportProvisionedRunnersParams): Promise<{
  accepted: number;
  reservationsReleased: number;
}> {
  if (params.events.length === 0) return {accepted: 0, reservationsReleased: 0};

  return await db().transaction(async (tx) => {
    const receivedAt = new Date();
    const events = aggregateEvents(params.events, receivedAt);
    const hasTerminalEvent = events.some((event) => isTerminalState(event.state));

    if (hasTerminalEvent) {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${params.workspaceId}))`);
    }

    const values = events.map((event) => ({
      workspaceId: params.workspaceId,
      provisionerId: params.provisionerId,
      provisionedRunnerId: event.provisionedRunnerId,
      reservationId: event.reservationId,
      templateKey: event.templateKey,
      labels: [...canonicalizeLabels(event.labels)],
      state: event.state,
      reason: event.reason,
      runnerSessionId: event.runnerSessionId,
      providerKind: event.providerKind,
      reportedAt: event.reportedAt > receivedAt ? receivedAt : event.reportedAt,
      startedAt: event.startedAt,
      stoppingAt: event.stoppingAt,
      stoppedAt: event.stoppedAt,
      failedAt: event.failedAt,
      terminatedAt: event.terminatedAt,
    }));

    await tx
      .insert(provisionedRunners)
      .values(values)
      .onConflictDoUpdate({
        target: [
          provisionedRunners.workspaceId,
          provisionedRunners.provisionerId,
          provisionedRunners.provisionedRunnerId,
        ],
        set: {
          reservationId: sql`CASE WHEN ${provisionedRunnerProjectionUpdateCondition()} THEN coalesce(excluded.reservation_id, ${provisionedRunners.reservationId}) ELSE ${provisionedRunners.reservationId} END`,
          templateKey: sql`CASE WHEN ${provisionedRunnerProjectionUpdateCondition()} THEN coalesce(excluded.template_key, ${provisionedRunners.templateKey}) ELSE ${provisionedRunners.templateKey} END`,
          labels: sql`CASE WHEN ${provisionedRunnerProjectionUpdateCondition()} THEN excluded.labels ELSE ${provisionedRunners.labels} END`,
          state: sql`CASE WHEN ${provisionedRunnerProjectionUpdateCondition()} THEN excluded.state ELSE ${provisionedRunners.state} END`,
          reason: sql`CASE WHEN ${provisionedRunnerProjectionUpdateCondition()} THEN excluded.reason ELSE ${provisionedRunners.reason} END`,
          runnerSessionId: sql`CASE WHEN ${provisionedRunnerProjectionUpdateCondition()} THEN coalesce(excluded.runner_session_id, ${provisionedRunners.runnerSessionId}) ELSE ${provisionedRunners.runnerSessionId} END`,
          providerKind: sql`CASE WHEN ${provisionedRunnerProjectionUpdateCondition()} THEN coalesce(excluded.provider_kind, ${provisionedRunners.providerKind}) ELSE ${provisionedRunners.providerKind} END`,
          reportedAt: sql`CASE WHEN ${provisionedRunnerProjectionUpdateCondition()} THEN excluded.reported_at ELSE ${provisionedRunners.reportedAt} END`,
          startedAt: firstObservedAt(provisionedRunners.startedAt, sql`excluded.started_at`),
          stoppingAt: firstObservedAt(provisionedRunners.stoppingAt, sql`excluded.stopping_at`),
          stoppedAt: firstObservedAt(provisionedRunners.stoppedAt, sql`excluded.stopped_at`),
          failedAt: firstObservedAt(provisionedRunners.failedAt, sql`excluded.failed_at`),
          terminatedAt: firstObservedAt(
            provisionedRunners.terminatedAt,
            sql`excluded.terminated_at`,
          ),
          updatedAt: sql`now()`,
        },
        setWhere: sql`
          ${provisionedRunnerProjectionUpdateCondition()}
          OR ${provisionedRunnerMilestoneUpdateCondition()}
        `,
      });

    const reservationsReleased = hasTerminalEvent
      ? await releaseTerminalProvisionedRunnerReservations(tx, params, events)
      : 0;

    return {accepted: events.length, reservationsReleased};
  });
}

export async function listActiveProvisionedRunners(params: {
  workspaceId: string;
  windowSeconds: number;
  limit?: number;
}): Promise<ProvisionedRunner[]> {
  const rows = await db()
    .select()
    .from(provisionedRunners)
    .where(
      and(
        eq(provisionedRunners.workspaceId, params.workspaceId),
        inArray(provisionedRunners.state, activeStates),
        sql`${provisionedRunners.updatedAt} > now() - (${params.windowSeconds} || ' seconds')::interval`,
      ),
    )
    .orderBy(desc(provisionedRunners.updatedAt), desc(provisionedRunners.id))
    .limit(params.limit ?? 1000);

  return rows.map(toProvisionedRunner);
}

export async function listProvisionerTerminateIntents(params: {
  workspaceId: string;
  provisionerId: string;
  limit: number;
}): Promise<string[]> {
  return await db().transaction(async (tx) => listProvisionerTerminateIntentsTx(tx, params));
}

export async function listProvisionerTerminateIntentsTx(
  tx: Tx,
  params: {
    workspaceId: string;
    provisionerId: string;
    limit: number;
  },
): Promise<string[]> {
  const rows = await provisionerTerminateIntentsQuery(tx, params)
    .orderBy(asc(provisionedRunners.provisionedRunnerId))
    .limit(params.limit + 1);

  const truncated = rows.length > params.limit;
  const returnedRows = truncated ? rows.slice(0, params.limit) : rows;
  if (truncated) {
    logger().warn(
      {
        workspaceId: params.workspaceId,
        provisionerId: params.provisionerId,
        limit: params.limit,
        returnedCount: returnedRows.length,
      },
      'provisioner terminate intents truncated by poll-demand limit',
    );
  }

  return returnedRows.map((row) => row.provisionedRunnerId);
}

function provisionerTerminateIntentsQuery(
  tx: Tx,
  params: {workspaceId: string; provisionerId: string},
) {
  const newerRunningJobExecutions = alias(runningJobExecutions, 'newer_running_jobs');

  return tx
    .select({provisionedRunnerId: provisionedRunners.provisionedRunnerId})
    .from(runningJobExecutions)
    .innerJoin(
      provisionedRunners,
      and(
        eq(provisionedRunners.workspaceId, runningJobExecutions.workspaceId),
        eq(provisionedRunners.provisionerId, runningJobExecutions.provisionerId),
        eq(provisionedRunners.provisionedRunnerId, runningJobExecutions.provisionedRunnerId),
      ),
    )
    .where(
      and(
        eq(runningJobExecutions.workspaceId, params.workspaceId),
        eq(runningJobExecutions.provisionerId, params.provisionerId),
        isNotNull(runningJobExecutions.cancellationRequestedAt),
        inArray(provisionedRunners.state, activeStates),
        notExists(
          tx
            .select({id: newerRunningJobExecutions.id})
            .from(newerRunningJobExecutions)
            .where(
              and(
                eq(newerRunningJobExecutions.workspaceId, runningJobExecutions.workspaceId),
                eq(newerRunningJobExecutions.provisionerId, runningJobExecutions.provisionerId),
                eq(
                  newerRunningJobExecutions.provisionedRunnerId,
                  runningJobExecutions.provisionedRunnerId,
                ),
                or(
                  gt(newerRunningJobExecutions.startedAt, runningJobExecutions.startedAt),
                  and(
                    eq(newerRunningJobExecutions.startedAt, runningJobExecutions.startedAt),
                    gt(
                      newerRunningJobExecutions.jobExecutionId,
                      runningJobExecutions.jobExecutionId,
                    ),
                  ),
                ),
              ),
            ),
        ),
      ),
    )
    .groupBy(provisionedRunners.provisionedRunnerId);
}

export async function reconcileProvisionedRunners(
  params: ReconcileProvisionedRunnersParams,
): Promise<ReconcileProvisionedRunnersDbResult> {
  const observedProvisionedRunnerIds = [...new Set(params.observedProvisionedRunnerIds)];

  return await db().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${params.workspaceId}))`);

    const staleAbsentWhere = and(
      eq(provisionedRunners.workspaceId, params.workspaceId),
      eq(provisionedRunners.provisionerId, params.provisionerId),
      inArray(provisionedRunners.state, activeStates),
      lt(
        provisionedRunners.reportedAt,
        sql`now() - (${params.terminateGraceSeconds} || ' seconds')::interval`,
      ),
      observedProvisionedRunnerIds.length > 0
        ? notInArray(provisionedRunners.provisionedRunnerId, observedProvisionedRunnerIds)
        : undefined,
    );

    const staleAbsentRows = await tx
      .select({
        id: provisionedRunners.id,
        provisionedRunnerId: provisionedRunners.provisionedRunnerId,
      })
      .from(provisionedRunners)
      .where(staleAbsentWhere);

    const absentIds = staleAbsentRows.map((row) => row.provisionedRunnerId);
    let reservationsReleased = 0;
    if (staleAbsentRows.length > 0) {
      const updated = await tx
        .update(provisionedRunners)
        .set({
          state: 'terminated',
          terminatedAt: sql`coalesce(${provisionedRunners.terminatedAt}, now())`,
          updatedAt: sql`now()`,
        })
        .where(
          and(
            inArray(
              provisionedRunners.id,
              staleAbsentRows.map((row) => row.id),
            ),
            inArray(provisionedRunners.state, activeStates),
            lt(
              provisionedRunners.reportedAt,
              sql`now() - (${params.terminateGraceSeconds} || ' seconds')::interval`,
            ),
          ),
        )
        .returning({provisionedRunnerId: provisionedRunners.provisionedRunnerId});

      reservationsReleased = await releaseTerminalProvisionedRunnerReservationsByIds(tx, {
        workspaceId: params.workspaceId,
        provisionerId: params.provisionerId,
        provisionedRunnerIds: updated.map((row) => row.provisionedRunnerId),
      });
    }

    const observedRows =
      observedProvisionedRunnerIds.length === 0
        ? []
        : (
            await tx
              .select()
              .from(provisionedRunners)
              .where(
                and(
                  eq(provisionedRunners.workspaceId, params.workspaceId),
                  eq(provisionedRunners.provisionerId, params.provisionerId),
                  inArray(provisionedRunners.provisionedRunnerId, observedProvisionedRunnerIds),
                ),
              )
          ).map(toProvisionedRunner);

    const boundJobExecutions = await listRunningJobExecutionsByProvisionedRunnerTx(tx, {
      workspaceId: params.workspaceId,
      provisionerId: params.provisionerId,
      provisionedRunnerIds: observedProvisionedRunnerIds,
    });

    return {
      observedRows,
      boundJobExecutionsByProvisionedRunnerId: new Map(
        boundJobExecutions.map((jobExecution) => [jobExecution.provisionedRunnerId, jobExecution]),
      ),
      absentIds,
      reservationsReleased,
    };
  });
}

async function releaseTerminalProvisionedRunnerReservations(
  tx: Tx,
  params: ReportProvisionedRunnersParams,
  events: ProvisionedRunnerReportEvent[],
): Promise<number> {
  const terminalEvents = events.filter((event) => isTerminalState(event.state));
  if (terminalEvents.length === 0) return 0;

  return await releaseTerminalProvisionedRunnerReservationsByIds(tx, {
    workspaceId: params.workspaceId,
    provisionerId: params.provisionerId,
    provisionedRunnerIds: terminalEvents.map((event) => event.provisionedRunnerId),
  });
}

async function releaseTerminalProvisionedRunnerReservationsByIds(
  tx: Tx,
  params: {
    workspaceId: string;
    provisionerId: string;
    provisionedRunnerIds: string[];
  },
): Promise<number> {
  if (params.provisionedRunnerIds.length === 0) return 0;

  const rows = await tx
    .select({
      id: provisionedRunners.id,
      reservationId: provisionedRunners.reservationId,
    })
    .from(provisionedRunners)
    .where(
      and(
        eq(provisionedRunners.workspaceId, params.workspaceId),
        eq(provisionedRunners.provisionerId, params.provisionerId),
        inArray(provisionedRunners.provisionedRunnerId, params.provisionedRunnerIds),
        inArray(provisionedRunners.state, terminalStates),
        isNotNull(provisionedRunners.reservationId),
        isNull(provisionedRunners.runnerSessionId),
        isNull(provisionedRunners.reservationReleasedAt),
      ),
    );

  if (rows.length === 0) return 0;

  const updated = await tx
    .update(provisionedRunners)
    .set({reservationReleasedAt: sql`now()`, updatedAt: sql`now()`})
    .where(
      and(
        inArray(
          provisionedRunners.id,
          rows.map((row) => row.id),
        ),
        isNull(provisionedRunners.reservationReleasedAt),
      ),
    )
    .returning({reservationId: provisionedRunners.reservationId});

  const releasesByReservationId = new Map<string, number>();
  for (const row of updated) {
    if (!row.reservationId) continue;
    releasesByReservationId.set(
      row.reservationId,
      (releasesByReservationId.get(row.reservationId) ?? 0) + 1,
    );
  }

  if (releasesByReservationId.size === 0) return 0;

  return await releaseReservationUnits(tx, {
    workspaceId: params.workspaceId,
    provisionerId: params.provisionerId,
    releases: [...releasesByReservationId].map(([reservationId, count]) => ({
      reservationId,
      count,
    })),
  });
}

function aggregateEvents(
  events: ProvisionedRunnerReportEvent[],
  receivedAt: Date,
): ProvisionedRunnerReportRow[] {
  const byProvisionedRunnerId = new Map<string, ProvisionedRunnerReportRow>();
  for (const rawEvent of events) {
    const event = toProvisionedRunnerReportRow(rawEvent, receivedAt);
    const existing = byProvisionedRunnerId.get(event.provisionedRunnerId);
    if (existing) mergeMilestones(existing, event);
    if (!existing || compareProvisionedRunnerReportEvents(event, existing) > 0) {
      byProvisionedRunnerId.set(
        event.provisionedRunnerId,
        existing ? mergeProjectionMetadata(event, existing) : event,
      );
    }
  }
  return [...byProvisionedRunnerId.values()];
}

function toProvisionedRunnerReportRow(
  event: ProvisionedRunnerReportEvent,
  receivedAt: Date,
): ProvisionedRunnerReportRow {
  const reportedAt = event.reportedAt > receivedAt ? receivedAt : event.reportedAt;
  return {
    ...event,
    reportedAt,
    startedAt: event.state === 'running' ? reportedAt : null,
    stoppingAt: event.state === 'stopping' ? reportedAt : null,
    stoppedAt: event.state === 'stopped' ? reportedAt : null,
    failedAt: event.state === 'failed' ? reportedAt : null,
    terminatedAt: event.state === 'terminated' ? reportedAt : null,
  };
}

function mergeMilestones(target: ProvisionedRunnerReportRow, source: ProvisionedRunnerReportRow) {
  target.startedAt = earliestDate(target.startedAt, source.startedAt);
  target.stoppingAt = earliestDate(target.stoppingAt, source.stoppingAt);
  target.stoppedAt = earliestDate(target.stoppedAt, source.stoppedAt);
  target.failedAt = earliestDate(target.failedAt, source.failedAt);
  target.terminatedAt = earliestDate(target.terminatedAt, source.terminatedAt);
}

function mergeProjectionMetadata(
  event: ProvisionedRunnerReportRow,
  existing: ProvisionedRunnerReportRow,
): ProvisionedRunnerReportRow {
  return {
    ...event,
    reservationId: event.reservationId ?? existing.reservationId,
    templateKey: event.templateKey ?? existing.templateKey,
    runnerSessionId: event.runnerSessionId ?? existing.runnerSessionId,
    providerKind: event.providerKind ?? existing.providerKind,
    ...pickMilestones(existing),
  };
}

function pickMilestones(event: ProvisionedRunnerReportRow) {
  return {
    startedAt: event.startedAt,
    stoppingAt: event.stoppingAt,
    stoppedAt: event.stoppedAt,
    failedAt: event.failedAt,
    terminatedAt: event.terminatedAt,
  };
}

function earliestDate(a: Date | null, b: Date | null): Date | null {
  if (!a) return b;
  if (!b) return a;
  return a < b ? a : b;
}

function compareProvisionedRunnerReportEvents(
  a: ProvisionedRunnerReportEvent,
  b: ProvisionedRunnerReportEvent,
): number {
  const timeDelta = a.reportedAt.getTime() - b.reportedAt.getTime();
  const rankDelta = getProvisionedRunnerStateRank(a.state) - getProvisionedRunnerStateRank(b.state);
  if (rankDelta !== 0) return rankDelta;
  return timeDelta;
}

function getProvisionedRunnerStateRank(state: ProvisionedRunnerState): number {
  switch (state) {
    case 'starting':
      return 1;
    case 'running':
      return 2;
    case 'stopping':
      return 3;
    case 'stopped':
      return 4;
    case 'failed':
      return 5;
    case 'terminated':
      return 6;
  }
}

function provisionedRunnerStateRank(state: SQL | typeof provisionedRunners.state): SQL<number> {
  return sql<number>`
    CASE ${state}
      WHEN 'starting' THEN 1
      WHEN 'running' THEN 2
      WHEN 'stopping' THEN 3
      WHEN 'stopped' THEN 4
      WHEN 'failed' THEN 5
      WHEN 'terminated' THEN 6
      ELSE 0
    END
  `;
}

function provisionedRunnerProjectionUpdateCondition(): SQL<boolean> {
  return sql<boolean>`
    ${provisionedRunnerStateRank(sql`excluded.state`)} > ${provisionedRunnerStateRank(provisionedRunners.state)}
    OR (
      ${provisionedRunnerStateRank(sql`excluded.state`)} = ${provisionedRunnerStateRank(provisionedRunners.state)}
      AND excluded.reported_at >= ${provisionedRunners.reportedAt}
    )
  `;
}

function provisionedRunnerMilestoneUpdateCondition(): SQL<boolean> {
  return sql<boolean>`
    ${milestoneNeedsUpdate(provisionedRunners.startedAt, sql`excluded.started_at`)}
    OR ${milestoneNeedsUpdate(provisionedRunners.stoppingAt, sql`excluded.stopping_at`)}
    OR ${milestoneNeedsUpdate(provisionedRunners.stoppedAt, sql`excluded.stopped_at`)}
    OR ${milestoneNeedsUpdate(provisionedRunners.failedAt, sql`excluded.failed_at`)}
    OR ${milestoneNeedsUpdate(provisionedRunners.terminatedAt, sql`excluded.terminated_at`)}
  `;
}

function milestoneNeedsUpdate(
  current: SQL | ProvisionedRunnerMilestoneColumn,
  incoming: SQL,
): SQL<boolean> {
  return sql<boolean>`${incoming} IS NOT NULL AND (${current} IS NULL OR ${incoming} < ${current})`;
}

function firstObservedAt(current: SQL | ProvisionedRunnerMilestoneColumn, incoming: SQL) {
  return sql`
    CASE
      WHEN ${incoming} IS NULL THEN ${current}
      WHEN ${current} IS NULL THEN ${incoming}
      ELSE least(${current}, ${incoming})
    END
  `;
}

export function isTerminalState(state: ProvisionedRunnerState): boolean {
  return terminalStates.includes(state as (typeof terminalStates)[number]);
}
