import * as nodeCrypto from 'node:crypto';
import type {
  DemandStatDto,
  MintRegistrationTokensBatchResponseDto,
  PollDemandTemplateDto,
} from '@shipfox/api-runners-dto';
import {logger} from '@shipfox/node-opentelemetry';
import type {ProvisionerClient} from '#api-client.js';
import {type PlannedLaunchGroup, planLaunches, templateAvailableSlots} from '#capacity.js';
import type {ProviderRunnerTracker} from '#tracker.js';
import type {LaunchRunner, ProvisionerTemplate, TerminateRunners} from '#types.js';

/** The API caps reservations per poll at 1000; never advertise a larger appetite. */
const MAX_RESERVATIONS_PER_POLL = 1000;

const cryptoWithUuidV7 = nodeCrypto as typeof nodeCrypto & {
  randomUUIDv7(): string;
};

export type RunnerEnvFactory<Spec> = (args: {
  template: ProvisionerTemplate<Spec>;
  registrationToken: string;
}) => Record<string, string>;

export interface ProvisionerTickDeps<Spec> {
  readonly client: ProvisionerClient;
  readonly templates: readonly ProvisionerTemplate<Spec>[];
  readonly tracker: ProviderRunnerTracker;
  readonly launch: LaunchRunner<Spec>;
  readonly terminate?: TerminateRunners;
  readonly buildRunnerEnv: RunnerEnvFactory<Spec>;
  readonly maxReservations: number;
  readonly waitSeconds: number;
  readonly registrationTokenBatchSize: number;
  readonly signal?: AbortSignal;
}

export interface ProvisionerTickResult {
  readonly stats: readonly DemandStatDto[];
  readonly reservationCount: number;
  readonly plannedCount: number;
  readonly launchAttemptedCount: number;
  readonly launchedCount: number;
}

/**
 * One cycle of the control loop: advertise current capacity, long-poll demand, plan
 * launches for the reservations the API grants without exceeding local concurrency,
 * batch-mint a registration token per planned runner, and hand each to the launcher.
 * All mutation flows through injected ports, so the cycle is deterministic to test.
 */
export async function runProvisionerTick<Spec>(
  deps: ProvisionerTickDeps<Spec>,
): Promise<ProvisionerTickResult> {
  const counts = deps.tracker.countsByTemplate();
  const advertisements: PollDemandTemplateDto[] = deps.templates.map((template) => {
    const templateCounts = counts.get(template.key) ?? {starting: 0, running: 0};
    return {
      template_key: template.key,
      labels: [...template.labels],
      available_slots: templateAvailableSlots(template, templateCounts),
      starting: templateCounts.starting,
      running: templateCounts.running,
    };
  });

  const availableByKey = new Map(
    advertisements.map((advertisement) => [
      advertisement.template_key,
      advertisement.available_slots,
    ]),
  );
  const totalAvailable = advertisements.reduce(
    (sum, advertisement) => sum + advertisement.available_slots,
    0,
  );
  // Respect local max concurrency before asking: never reserve more than there are
  // free slots to fill (and never more than the API will grant in one poll).
  const maxReservations = Math.min(deps.maxReservations, totalAvailable, MAX_RESERVATIONS_PER_POLL);

  const response = await deps.client.pollDemand(
    {wait_seconds: deps.waitSeconds, max_reservations: maxReservations, templates: advertisements},
    deps.signal ? {signal: deps.signal} : {},
  );

  if (
    response.terminate_provider_runner_ids.length > 0 &&
    !deps.signal?.aborted &&
    deps.terminate
  ) {
    await deps.terminate(response.terminate_provider_runner_ids);
  }

  const planned = planLaunches({
    reservations: response.reservations.map((reservation) => ({
      reservationId: reservation.reservation_id,
      labels: reservation.labels,
      count: reservation.count,
    })),
    templates: deps.templates,
    availableByKey,
  });

  const plannedCount = planned.reduce((sum, group) => sum + group.count, 0);

  let launchAttemptedCount = 0;
  let launchedCount = 0;
  for (const [reservationId, groups] of groupByReservation(planned)) {
    if (deps.signal?.aborted) break;
    const result = await launchReservation(reservationId, groups, deps);
    launchAttemptedCount += result.attempted;
    launchedCount += result.launched;
  }

  return {
    stats: response.stats,
    reservationCount: response.reservations.length,
    plannedCount,
    launchAttemptedCount,
    launchedCount,
  };
}

async function launchReservation<Spec>(
  reservationId: string,
  groups: readonly PlannedLaunchGroup<Spec>[],
  deps: ProvisionerTickDeps<Spec>,
): Promise<{attempted: number; launched: number}> {
  // A fresh, never-reused id per runner: it binds the ephemeral registration token,
  // names the resource, and keys idempotent reporting and reconciliation. UUIDv7 keeps
  // generated ids time-ordered without adding a dependency.
  const plannedRunners = groups.flatMap((group) =>
    Array.from({length: group.count}, () => ({
      providerRunnerId: cryptoWithUuidV7.randomUUIDv7(),
      template: group.template,
    })),
  );
  const templateById = new Map<string, ProvisionerTemplate<Spec>>(
    plannedRunners.map((runner) => [runner.providerRunnerId, runner.template]),
  );

  let attempted = 0;
  let launched = 0;
  for (const batch of chunk(plannedRunners, deps.registrationTokenBatchSize)) {
    if (deps.signal?.aborted) break;
    let minted: MintRegistrationTokensBatchResponseDto;
    try {
      minted = await deps.client.mintRegistrationTokens(
        {
          reservation_id: reservationId,
          runner_instances: batch.map((runner) => ({
            provider_runner_id: runner.providerRunnerId,
          })),
        },
        deps.signal ? {signal: deps.signal} : {},
      );
    } catch (error) {
      // Leave these slots free: the reservation TTL releases the demand and another
      // tick (or another provisioner) can pick it up.
      logger().error({err: error, reservationId}, 'Failed to mint registration tokens');
      continue;
    }

    if (minted.tokens.length < batch.length) {
      // The mint endpoint is atomic, so a shortfall is unexpected; surface it rather
      // than silently dropping the runners that got no token.
      logger().warn(
        {reservationId, requested: batch.length, minted: minted.tokens.length},
        'Mint returned fewer registration tokens than requested',
      );
    }

    for (const token of minted.tokens) {
      if (deps.signal?.aborted) break;
      const template = templateById.get(token.provider_runner_id);
      if (!template) continue;

      deps.tracker.recordStarting({
        providerRunnerId: token.provider_runner_id,
        templateKey: template.key,
      });
      attempted += 1;
      try {
        await deps.launch({
          providerRunnerId: token.provider_runner_id,
          reservationId,
          template,
          registrationToken: token.registration_token,
          registrationTokenExpiresAt: token.expires_at,
          runnerEnv: deps.buildRunnerEnv({template, registrationToken: token.registration_token}),
        });
        launched += 1;
      } catch (error) {
        // The launch call rejected, so no resource was created: free the slot now instead
        // of leaving a phantom `starting` runner. A persistent failure (bad image, daemon
        // down) would otherwise drain capacity to zero and wedge the loop until restart.
        deps.tracker.remove(token.provider_runner_id);
        logger().error(
          {err: error, providerRunnerId: token.provider_runner_id},
          'Failed to launch provisioned runner',
        );
      }
    }
  }

  return {attempted, launched};
}

function groupByReservation<Spec>(
  planned: readonly PlannedLaunchGroup<Spec>[],
): Map<string, PlannedLaunchGroup<Spec>[]> {
  const byReservation = new Map<string, PlannedLaunchGroup<Spec>[]>();
  for (const group of planned) {
    const existing = byReservation.get(group.reservationId);
    if (existing) existing.push(group);
    else byReservation.set(group.reservationId, [group]);
  }
  return byReservation;
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }
  return batches;
}
