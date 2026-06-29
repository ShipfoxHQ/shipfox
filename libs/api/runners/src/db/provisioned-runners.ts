import {canonicalizeRunnerLabels} from '@shipfox/api-runners-dto';
import {and, desc, eq, inArray, isNotNull, isNull, type SQL, sql} from 'drizzle-orm';
import type {ProvisionedRunner, ProvisionedRunnerState} from '#core/entities/provisioned-runner.js';
import type {Tx} from './db.js';
import {db} from './db.js';
import {releaseReservationUnits} from './reservations.js';
import {provisionedRunners, toProvisionedRunner} from './schema/provisioned-runners.js';

const terminalStates = ['stopped', 'failed'] as const satisfies readonly ProvisionedRunnerState[];
const activeStates = [
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

export async function reportProvisionedRunners(params: ReportProvisionedRunnersParams): Promise<{
  accepted: number;
  reservationsReleased: number;
}> {
  const events = dedupeEvents(params.events);
  if (events.length === 0) return {accepted: 0, reservationsReleased: 0};

  const hasTerminalEvent = events.some((event) => isTerminalState(event.state));

  return await db().transaction(async (tx) => {
    if (hasTerminalEvent) {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${params.workspaceId}))`);
    }

    const receivedAt = new Date();
    const values = events.map((event) => ({
      workspaceId: params.workspaceId,
      provisionerId: params.provisionerId,
      provisionedRunnerId: event.provisionedRunnerId,
      reservationId: event.reservationId,
      templateKey: event.templateKey,
      labels: canonicalizeRunnerLabels(event.labels),
      state: event.state,
      reason: event.reason,
      runnerSessionId: event.runnerSessionId,
      providerKind: event.providerKind,
      reportedAt: event.reportedAt > receivedAt ? receivedAt : event.reportedAt,
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
          reservationId: sql`coalesce(excluded.reservation_id, ${provisionedRunners.reservationId})`,
          templateKey: sql`coalesce(excluded.template_key, ${provisionedRunners.templateKey})`,
          labels: sql`excluded.labels`,
          state: sql`excluded.state`,
          reason: sql`excluded.reason`,
          runnerSessionId: sql`coalesce(excluded.runner_session_id, ${provisionedRunners.runnerSessionId})`,
          providerKind: sql`coalesce(excluded.provider_kind, ${provisionedRunners.providerKind})`,
          reportedAt: sql`excluded.reported_at`,
          updatedAt: sql`now()`,
        },
        setWhere: sql`
          excluded.reported_at > ${provisionedRunners.reportedAt}
          OR (
            excluded.reported_at = ${provisionedRunners.reportedAt}
            AND ${provisionedRunnerStateRank(sql`excluded.state`)} >= ${provisionedRunnerStateRank(provisionedRunners.state)}
          )
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

async function releaseTerminalProvisionedRunnerReservations(
  tx: Tx,
  params: ReportProvisionedRunnersParams,
  events: ProvisionedRunnerReportEvent[],
): Promise<number> {
  const terminalEvents = events.filter((event) => isTerminalState(event.state));
  if (terminalEvents.length === 0) return 0;

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
        inArray(
          provisionedRunners.provisionedRunnerId,
          terminalEvents.map((event) => event.provisionedRunnerId),
        ),
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

function dedupeEvents(events: ProvisionedRunnerReportEvent[]): ProvisionedRunnerReportEvent[] {
  const byProvisionedRunnerId = new Map<string, ProvisionedRunnerReportEvent>();
  for (const event of events) {
    const existing = byProvisionedRunnerId.get(event.provisionedRunnerId);
    if (!existing || compareProvisionedRunnerReportEvents(event, existing) > 0) {
      byProvisionedRunnerId.set(event.provisionedRunnerId, event);
    }
  }
  return [...byProvisionedRunnerId.values()];
}

function compareProvisionedRunnerReportEvents(
  a: ProvisionedRunnerReportEvent,
  b: ProvisionedRunnerReportEvent,
): number {
  const timeDelta = a.reportedAt.getTime() - b.reportedAt.getTime();
  if (timeDelta !== 0) return timeDelta;
  return getProvisionedRunnerStateRank(a.state) - getProvisionedRunnerStateRank(b.state);
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
      ELSE 0
    END
  `;
}

function isTerminalState(state: ProvisionedRunnerState): boolean {
  return terminalStates.includes(state as (typeof terminalStates)[number]);
}
