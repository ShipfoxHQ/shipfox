import {canonicalizeRunnerLabels} from '@shipfox/api-runners-dto';
import {and, desc, eq, inArray, isNotNull, isNull, type SQL, sql} from 'drizzle-orm';
import type {Resource, ResourceState} from '#core/entities/resource.js';
import type {Tx} from './db.js';
import {db} from './db.js';
import {releaseReservationUnits} from './reservations.js';
import {resources, toResource} from './schema/resources.js';

const terminalStates = ['stopped', 'failed'] as const satisfies readonly ResourceState[];
const activeStates = [
  'starting',
  'running',
  'stopping',
] as const satisfies readonly ResourceState[];

export interface ResourceReportEvent {
  resourceId: string;
  reservationId: string | null;
  templateKey: string | null;
  labels: string[];
  state: ResourceState;
  reason: string | null;
  runnerSessionId: string | null;
  providerKind: string | null;
  reportedAt: Date;
}

export interface ReportResourcesParams {
  workspaceId: string;
  provisionerId: string;
  events: ResourceReportEvent[];
}

export async function reportResources(params: ReportResourcesParams): Promise<{
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

    const values = events.map((event) => ({
      workspaceId: params.workspaceId,
      provisionerId: params.provisionerId,
      resourceId: event.resourceId,
      reservationId: event.reservationId,
      templateKey: event.templateKey,
      labels: canonicalizeRunnerLabels(event.labels),
      state: event.state,
      reason: event.reason,
      runnerSessionId: event.runnerSessionId,
      providerKind: event.providerKind,
      reportedAt: sql`least(${event.reportedAt}, now())`,
    }));

    await tx
      .insert(resources)
      .values(values)
      .onConflictDoUpdate({
        target: [resources.workspaceId, resources.provisionerId, resources.resourceId],
        set: {
          reservationId: sql`coalesce(excluded.reservation_id, ${resources.reservationId})`,
          templateKey: sql`coalesce(excluded.template_key, ${resources.templateKey})`,
          labels: sql`excluded.labels`,
          state: sql`excluded.state`,
          reason: sql`excluded.reason`,
          runnerSessionId: sql`coalesce(excluded.runner_session_id, ${resources.runnerSessionId})`,
          providerKind: sql`coalesce(excluded.provider_kind, ${resources.providerKind})`,
          reportedAt: sql`least(excluded.reported_at, now())`,
          updatedAt: sql`now()`,
        },
        setWhere: sql`
          excluded.reported_at > ${resources.reportedAt}
          OR (
            excluded.reported_at = ${resources.reportedAt}
            AND ${resourceStateRank(sql`excluded.state`)} >= ${resourceStateRank(resources.state)}
          )
        `,
      });

    const reservationsReleased = hasTerminalEvent
      ? await releaseTerminalResourceReservations(tx, params, events)
      : 0;

    return {accepted: events.length, reservationsReleased};
  });
}

export async function listActiveResources(params: {
  workspaceId: string;
  windowSeconds: number;
  limit?: number;
}): Promise<Resource[]> {
  const rows = await db()
    .select()
    .from(resources)
    .where(
      and(
        eq(resources.workspaceId, params.workspaceId),
        inArray(resources.state, activeStates),
        sql`${resources.updatedAt} > now() - (${params.windowSeconds} || ' seconds')::interval`,
      ),
    )
    .orderBy(desc(resources.updatedAt), desc(resources.id))
    .limit(params.limit ?? 1000);

  return rows.map(toResource);
}

async function releaseTerminalResourceReservations(
  tx: Tx,
  params: ReportResourcesParams,
  events: ResourceReportEvent[],
): Promise<number> {
  const terminalEvents = events.filter((event) => isTerminalState(event.state));
  if (terminalEvents.length === 0) return 0;

  const rows = await tx
    .select({
      id: resources.id,
      reservationId: resources.reservationId,
    })
    .from(resources)
    .where(
      and(
        eq(resources.workspaceId, params.workspaceId),
        eq(resources.provisionerId, params.provisionerId),
        inArray(
          resources.resourceId,
          terminalEvents.map((event) => event.resourceId),
        ),
        inArray(resources.state, terminalStates),
        isNotNull(resources.reservationId),
        isNull(resources.runnerSessionId),
        isNull(resources.reservationReleasedAt),
      ),
    );

  if (rows.length === 0) return 0;

  const updated = await tx
    .update(resources)
    .set({reservationReleasedAt: sql`now()`, updatedAt: sql`now()`})
    .where(
      and(
        inArray(
          resources.id,
          rows.map((row) => row.id),
        ),
        isNull(resources.reservationReleasedAt),
      ),
    )
    .returning({reservationId: resources.reservationId});

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

function dedupeEvents(events: ResourceReportEvent[]): ResourceReportEvent[] {
  const byResourceId = new Map<string, ResourceReportEvent>();
  for (const event of events) {
    const existing = byResourceId.get(event.resourceId);
    if (!existing || compareResourceReportEvents(event, existing) > 0) {
      byResourceId.set(event.resourceId, event);
    }
  }
  return [...byResourceId.values()];
}

function compareResourceReportEvents(a: ResourceReportEvent, b: ResourceReportEvent): number {
  const timeDelta = a.reportedAt.getTime() - b.reportedAt.getTime();
  if (timeDelta !== 0) return timeDelta;
  return getResourceStateRank(a.state) - getResourceStateRank(b.state);
}

function getResourceStateRank(state: ResourceState): number {
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

function resourceStateRank(state: SQL | typeof resources.state): SQL<number> {
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

function isTerminalState(state: ResourceState): boolean {
  return terminalStates.includes(state as (typeof terminalStates)[number]);
}
