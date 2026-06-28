import {setTimeout as sleep} from 'node:timers/promises';
import {config} from '#config.js';
import {
  type DemandStat,
  deleteReservationsByIds,
  pollDemandAndReserve,
  type ReservationGrant,
  type ReservationTemplate,
} from '#db/reservations.js';

export interface PollDemandParams {
  workspaceId: string;
  provisionerId: string;
  maxReservations: number;
  waitSeconds?: number | undefined;
  ttlSeconds: number;
  templates: ReservationTemplate[];
  signal: AbortSignal;
}

export interface PollDemandResult {
  stats: DemandStat[];
  reservations: ReservationGrant[];
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
  let lastResult: PollDemandResult = {stats: [], reservations: []};

  while (true) {
    if (params.signal.aborted) return lastResult;

    const previousResult = lastResult;
    const result = await pollDemandAndReserve({
      workspaceId: params.workspaceId,
      provisionerId: params.provisionerId,
      maxReservations: params.maxReservations,
      ttlSeconds: params.ttlSeconds,
      templates: params.templates,
    });
    if (params.signal.aborted) {
      await releaseReservationGrants(result.reservations);
      return previousResult;
    }

    lastResult = result;

    if (shouldReturn(lastResult, params.maxReservations, totalCapacity, Date.now() >= deadlineMs)) {
      return lastResult;
    }

    const remainingWaitMs = Math.max(0, deadlineMs - Date.now());
    try {
      await sleep(Math.min(withJitter(interval), remainingWaitMs), undefined, {
        signal: params.signal,
      });
    } catch (error) {
      if (params.signal.aborted) return lastResult;
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
    maxReservations === 0 || totalCapacity === 0 || result.reservations.length > 0 || deadlinePassed
  );
}

export function nextBackoffInterval(ms: number): number {
  return Math.min(ms * 1.5, config.RESERVATION_POLL_MAX_INTERVAL_MS);
}

export function withJitter(ms: number): number {
  return Math.random() * ms;
}
