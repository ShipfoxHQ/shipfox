import type {PollDemandResponseDto} from '@shipfox/api-runners-dto';
import {pollDemandResponseSchema} from '@shipfox/api-runners-dto';
import {createApiClient} from '@shipfox/e2e-core';

const DEFAULT_INTERVAL_MS = 1_000;
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RESERVATIONS = 1;

export interface DemandPollTemplate {
  name: string;
  labels: readonly string[];
  availableSlots?: number | undefined;
  starting?: number | undefined;
  running?: number | undefined;
}

export interface PollDemandParams {
  /** Provisioner bearer accepted by the real demand route. */
  provisionerToken: string;
  /** Templates the provisioner offers to the placement policy. */
  templates: readonly DemandPollTemplate[];
  /** Maximum reservations this poll may claim. Defaults to one. */
  maxReservations?: number | undefined;
  waitSeconds?: number | undefined;
  reservationTtlSeconds?: number | undefined;
}

export class DemandReservationError extends Error {
  readonly response: PollDemandResponseDto;

  constructor(response: PollDemandResponseDto) {
    super(
      `Demand poll granted ${response.reservations.length} reservation(s), but this driver does not claim reservations.`,
    );
    this.name = 'DemandReservationError';
    this.response = response;
  }
}

export class DemandPollTimeoutError extends Error {
  readonly response: PollDemandResponseDto;
  readonly pollCount: number;
  readonly timeoutMs: number;

  constructor(params: {
    response: PollDemandResponseDto;
    pollCount: number;
    timeoutMs: number;
  }) {
    super(`Demand poll timed out after ${params.timeoutMs}ms (${params.pollCount} polls).`);
    this.name = 'DemandPollTimeoutError';
    this.response = params.response;
    this.pollCount = params.pollCount;
    this.timeoutMs = params.timeoutMs;
  }
}

function toPollTemplate(template: DemandPollTemplate) {
  return {
    template_key: template.name,
    labels: [...template.labels],
    available_slots: template.availableSlots ?? 1,
    starting: template.starting ?? 0,
    running: template.running ?? 0,
  };
}

/** Sends one authenticated poll to the provisioner demand route. */
export async function pollDemand(params: PollDemandParams): Promise<PollDemandResponseDto> {
  const client = createApiClient({token: params.provisionerToken});
  const response = await client.requestJson<unknown>('post', '/provisioners/demand/poll', {
    json: {
      ...(params.waitSeconds === undefined ? {} : {wait_seconds: params.waitSeconds}),
      ...(params.reservationTtlSeconds === undefined
        ? {}
        : {reservation_ttl_seconds: params.reservationTtlSeconds}),
      max_reservations: params.maxReservations ?? DEFAULT_MAX_RESERVATIONS,
      templates: params.templates.map(toPollTemplate),
    },
  });
  const parsed = pollDemandResponseSchema.parse(response);
  if (parsed.reservations.length > 0) throw new DemandReservationError(parsed);
  return parsed;
}

export interface PollDemandUntilParams extends PollDemandParams {
  /** Observes the outcome after each poll; resolves when it returns true. */
  until: (response: PollDemandResponseDto, pollCount: number) => Promise<boolean> | boolean;
  intervalMs?: number | undefined;
  timeoutMs?: number | undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Repeats demand polls until the caller observes the expected outcome. */
export async function pollDemandUntil(
  params: PollDemandUntilParams,
): Promise<PollDemandResponseDto> {
  const timeoutMs = params.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const intervalMs = params.intervalMs ?? DEFAULT_INTERVAL_MS;
  const deadline = Date.now() + timeoutMs;
  const {until, intervalMs: _, timeoutMs: __, ...pollParams} = params;
  let pollCount = 0;
  let lastResponse: PollDemandResponseDto | undefined;

  while (true) {
    lastResponse = await pollDemand(pollParams);
    pollCount += 1;
    if (await until(lastResponse, pollCount)) return lastResponse;

    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      throw new DemandPollTimeoutError({response: lastResponse, pollCount, timeoutMs});
    }
    await sleep(Math.min(Math.max(0, intervalMs), remainingMs));
  }
}
