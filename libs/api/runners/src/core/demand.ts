import {setTimeout as sleep} from 'node:timers/promises';
import {config} from '#config.js';
import {db} from '#db/db.js';
import {
  type ActiveProvisionedRunnerTemplateCount,
  listActiveProvisionedRunnerCountsByTemplateTx,
  listProvisionerTerminateIntentRowsTx,
  type ProvisionedRunnerTerminateIntent,
} from '#db/provisioned-runners.js';
import {
  type DemandStat,
  deleteReservationsByIds,
  pollDemandAndReserveTx,
  type ReservationGrant,
  type ReservationTemplate,
} from '#db/reservations.js';
import {
  provisionedRunnerCountDivergenceCount,
  provisionedRunnerTerminateIntentIssuedCount,
} from '#metrics/instance.js';

export interface PollDemandParams {
  workspaceId: string;
  provisionerId: string;
  maxReservations: number;
  waitSeconds?: number | undefined;
  ttlSeconds: number;
  terminateIntentLimit: number;
  templates: ReservationTemplate[];
  signal: AbortSignal;
}

export interface PollDemandResult {
  stats: DemandStat[];
  reservations: ReservationGrant[];
  terminateProvisionedRunnerIds: string[];
}

export interface ProvisionedRunnerCountDivergence {
  templateKey: string;
  state: 'starting' | 'running';
  direction: 'backend-higher' | 'advertised-higher';
  delta: number;
}

interface PollDemandSnapshot {
  result: PollDemandResult;
  divergences: ProvisionedRunnerCountDivergence[];
  terminateIntents: ProvisionedRunnerTerminateIntent[];
}

export async function pollDemand(params: PollDemandParams): Promise<PollDemandResult> {
  const waitSeconds = Math.min(
    params.waitSeconds ?? config.RESERVATION_LONG_POLL_MAX_WAIT_SECONDS,
    config.RESERVATION_LONG_POLL_MAX_WAIT_SECONDS,
  );
  const deadlineMs = Date.now() + Math.max(0, waitSeconds) * 1000;
  const totalCapacity = params.templates.reduce(
    (total, template) => total + template.availableSlots,
    0,
  );
  let interval = config.RESERVATION_POLL_INTERVAL_MS;
  let lastSnapshot: PollDemandSnapshot = {
    result: {stats: [], reservations: [], terminateProvisionedRunnerIds: []},
    divergences: [],
    terminateIntents: [],
  };

  while (true) {
    if (params.signal.aborted) return lastSnapshot.result;

    const previousSnapshot = lastSnapshot;
    const deadlinePassed = Date.now() >= deadlineMs;
    const snapshot = await db().transaction(async (tx) => {
      const demand = await pollDemandAndReserveTx(tx, {
        workspaceId: params.workspaceId,
        provisionerId: params.provisionerId,
        maxReservations: params.maxReservations,
        ttlSeconds: params.ttlSeconds,
        templates: params.templates,
      });
      const terminateIntents = await listProvisionerTerminateIntentRowsTx(tx, {
        workspaceId: params.workspaceId,
        provisionerId: params.provisionerId,
        limit: params.terminateIntentLimit,
      });
      const result: PollDemandResult = {
        ...demand,
        terminateProvisionedRunnerIds: terminateIntents.map((intent) => intent.provisionedRunnerId),
      };

      if (!shouldReturn(result, params.maxReservations, totalCapacity, deadlinePassed)) {
        return {result, terminateIntents, divergences: []};
      }

      return {
        result,
        terminateIntents,
        divergences: calculateProvisionedRunnerCountDivergences({
          advertisedTemplates: params.templates,
          backendCounts: await listActiveProvisionedRunnerCountsByTemplateTx(tx, {
            workspaceId: params.workspaceId,
            provisionerId: params.provisionerId,
          }),
        }),
      };
    });
    if (params.signal.aborted) {
      await releaseReservationGrants(snapshot.result.reservations);
      return previousSnapshot.result;
    }

    lastSnapshot = snapshot;

    if (shouldReturn(lastSnapshot.result, params.maxReservations, totalCapacity, deadlinePassed)) {
      recordPollDemandMetrics(lastSnapshot);
      return lastSnapshot.result;
    }

    const remainingWaitMs = Math.max(0, deadlineMs - Date.now());
    try {
      await sleep(Math.min(withJitter(interval), remainingWaitMs), undefined, {
        signal: params.signal,
      });
    } catch (error) {
      if (params.signal.aborted) return lastSnapshot.result;
      throw error;
    }
    interval = nextBackoffInterval(interval);
  }
}

export async function releaseReservationGrants(reservations: ReservationGrant[]): Promise<void> {
  await deleteReservationsByIds(reservations.map((reservation) => reservation.reservationId));
}

export function shouldReturn(
  result: PollDemandResult,
  maxReservations: number,
  totalCapacity: number,
  deadlinePassed: boolean,
): boolean {
  return (
    maxReservations === 0 ||
    totalCapacity === 0 ||
    result.reservations.length > 0 ||
    result.terminateProvisionedRunnerIds.length > 0 ||
    deadlinePassed
  );
}

export function nextBackoffInterval(ms: number): number {
  return Math.min(ms * 1.5, config.RESERVATION_POLL_MAX_INTERVAL_MS);
}

export function withJitter(ms: number): number {
  return Math.random() * ms;
}

export function calculateProvisionedRunnerCountDivergences(params: {
  advertisedTemplates: ReservationTemplate[];
  backendCounts: ActiveProvisionedRunnerTemplateCount[];
}): ProvisionedRunnerCountDivergence[] {
  const advertisedCounts = new Map<string, number>();
  const backendCounts = new Map<string, number>();

  for (const template of params.advertisedTemplates) {
    addCount(advertisedCounts, countKey(template.templateKey, 'starting'), template.starting);
    addCount(advertisedCounts, countKey(template.templateKey, 'running'), template.running);
  }
  for (const count of params.backendCounts) {
    addCount(backendCounts, countKey(count.templateKey, count.state), count.count);
  }

  const keys = [...new Set([...advertisedCounts.keys(), ...backendCounts.keys()])].sort();
  return keys.flatMap((key) => {
    const advertised = advertisedCounts.get(key) ?? 0;
    const backend = backendCounts.get(key) ?? 0;
    if (advertised === backend) return [];

    const [templateKey, state] = splitCountKey(key);
    return [
      {
        templateKey,
        state,
        direction: backend > advertised ? 'backend-higher' : 'advertised-higher',
        delta: Math.abs(backend - advertised),
      },
    ];
  });
}

function recordPollDemandMetrics(snapshot: PollDemandSnapshot): void {
  for (const divergence of snapshot.divergences) {
    provisionedRunnerCountDivergenceCount.add(divergence.delta, {
      template_key: divergence.templateKey,
      state: divergence.state,
      direction: divergence.direction,
    });
  }
  for (const intent of snapshot.terminateIntents) {
    provisionedRunnerTerminateIntentIssuedCount.add(1, {
      surface: 'poll-demand',
      reason: intent.reason,
    });
  }
}

function addCount(counts: Map<string, number>, key: string, count: number): void {
  counts.set(key, (counts.get(key) ?? 0) + count);
}

function countKey(templateKey: string, state: 'starting' | 'running'): string {
  return `${templateKey}\0${state}`;
}

function splitCountKey(key: string): [string, 'starting' | 'running'] {
  const [templateKey, state] = key.split('\0');
  if (!templateKey || (state !== 'starting' && state !== 'running')) {
    throw new Error(`Invalid provisioned runner count key: ${key}`);
  }
  return [templateKey, state];
}
