import {canonicalizeRunnerLabels} from '@shipfox/api-runners-dto';
import {and, asc, eq, gt, inArray, lt, sql} from 'drizzle-orm';
import {db} from './db.js';
import {pendingJobs} from './schema/pending-jobs.js';
import {reservations} from './schema/reservations.js';

export interface ReservationTemplate {
  templateKey: string;
  labels: string[];
  availableSlots: number;
  starting: number;
  running: number;
}

export interface DemandStat {
  labels: string[];
  queued: number;
  reserved: number;
  oldestQueuedAt: Date;
}

export interface ReservationGrant {
  reservationId: string;
  labels: string[];
  count: number;
  expiresAt: Date;
}

export interface PollDemandAndReserveParams {
  workspaceId: string;
  provisionerId: string;
  maxReservations: number;
  ttlSeconds: number;
  templates: ReservationTemplate[];
}

interface NormalizedTemplate {
  templateKey: string;
  labels: string[];
  remainingSlots: number;
}

interface DemandRow {
  requiredLabels: string[];
  queued: number;
  oldestQueuedAt: Date;
}

export async function pollDemandAndReserve(
  params: PollDemandAndReserveParams,
): Promise<{stats: DemandStat[]; reservations: ReservationGrant[]}> {
  return await db().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${params.workspaceId}))`);

    const demandRows = (
      await tx
        .select({
          requiredLabels: pendingJobs.requiredLabels,
          queued: sql<number>`count(*)::int`,
          oldestQueuedAt: sql<Date | string>`min(${pendingJobs.createdAt})`,
        })
        .from(pendingJobs)
        .where(eq(pendingJobs.workspaceId, params.workspaceId))
        .groupBy(pendingJobs.requiredLabels)
    ).map((row) => ({
      ...row,
      oldestQueuedAt: new Date(row.oldestQueuedAt),
    }));

    const activeReservationRows = await tx
      .select({
        requiredLabels: reservations.requiredLabels,
        reserved: sql<number>`coalesce(sum(${reservations.count}), 0)::int`,
      })
      .from(reservations)
      .where(
        and(
          eq(reservations.workspaceId, params.workspaceId),
          gt(reservations.expiresAt, sql`now()`),
        ),
      )
      .groupBy(reservations.requiredLabels);

    const reservedByLabels = new Map(
      activeReservationRows.map((row) => [labelKey(row.requiredLabels), row.reserved]),
    );
    const templates = params.templates.map((template) => ({
      templateKey: template.templateKey,
      labels: canonicalizeRunnerLabels(template.labels),
      remainingSlots: template.availableSlots,
    }));
    const stats: DemandStat[] = [];
    const grants: ReservationGrant[] = [];
    let remainingMaxReservations = params.maxReservations;

    for (const demand of sortDemandRows(demandRows)) {
      const satisfyingTemplates = templates
        .filter((template) => isSubset(demand.requiredLabels, template.labels))
        .sort(
          (a, b) => a.labels.length - b.labels.length || a.templateKey.localeCompare(b.templateKey),
        );

      if (satisfyingTemplates.length === 0) continue;

      const reserved = reservedByLabels.get(labelKey(demand.requiredLabels)) ?? 0;
      const unreserved = Math.max(0, demand.queued - reserved);
      const capacity = satisfyingTemplates.reduce(
        (total, template) => total + template.remainingSlots,
        0,
      );
      const grant = Math.min(unreserved, capacity, remainingMaxReservations);
      let reservedAfterGrant = reserved;

      if (grant > 0 && params.maxReservations > 0) {
        const [inserted] = await tx
          .insert(reservations)
          .values({
            workspaceId: params.workspaceId,
            provisionerId: params.provisionerId,
            requiredLabels: demand.requiredLabels,
            count: grant,
            expiresAt: sql`now() + (${params.ttlSeconds} || ' seconds')::interval`,
          })
          .returning({id: reservations.id, expiresAt: reservations.expiresAt});

        if (!inserted) throw new Error('Insert returned no rows');

        remainingMaxReservations -= grant;
        drawSlots(satisfyingTemplates, grant);
        reservedAfterGrant += grant;
        grants.push({
          reservationId: inserted.id,
          labels: demand.requiredLabels,
          count: grant,
          expiresAt: inserted.expiresAt,
        });
      }

      stats.push({
        labels: demand.requiredLabels,
        queued: demand.queued,
        reserved: reservedAfterGrant,
        oldestQueuedAt: demand.oldestQueuedAt,
      });
    }

    return {stats, reservations: grants};
  });
}

export async function deleteExpiredReservations(params?: {limit?: number}): Promise<number> {
  const expiredIds = db()
    .select({id: reservations.id})
    .from(reservations)
    .where(lt(reservations.expiresAt, sql`now()`))
    .orderBy(asc(reservations.expiresAt))
    .limit(params?.limit ?? 1000);

  const deleted = await db()
    .delete(reservations)
    .where(inArray(reservations.id, expiredIds))
    .returning({id: reservations.id});

  return deleted.length;
}

function sortDemandRows(rows: DemandRow[]): DemandRow[] {
  return [...rows].sort((a, b) => {
    const specificity = b.requiredLabels.length - a.requiredLabels.length;
    if (specificity !== 0) return specificity;
    return a.oldestQueuedAt.getTime() - b.oldestQueuedAt.getTime();
  });
}

function isSubset(requiredLabels: string[], availableLabels: string[]): boolean {
  return requiredLabels.every((label) => availableLabels.includes(label));
}

function drawSlots(templates: NormalizedTemplate[], count: number): void {
  let remaining = count;
  for (const template of templates) {
    if (remaining === 0) return;
    const used = Math.min(template.remainingSlots, remaining);
    template.remainingSlots -= used;
    remaining -= used;
  }
}

function labelKey(labels: string[]): string {
  return JSON.stringify(labels);
}
