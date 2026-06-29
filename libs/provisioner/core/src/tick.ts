import type {
  DemandStatDto,
  MintRegistrationTokensBatchResponseDto,
  PollDemandTemplateDto,
} from '@shipfox/api-runners-dto';
import {logger} from '@shipfox/node-opentelemetry';
import type {ProvisionerClient} from '#api-client.js';
import {type PlannedLaunchGroup, planLaunches, templateAvailableSlots} from '#capacity.js';
import {newProvisionedRunnerId} from '#ids.js';
import type {ProvisionedRunnerTracker} from '#tracker.js';
import type {LaunchRunner, ProvisionerTemplate} from '#types.js';

/** The API caps reservations per poll at 1000; never advertise a larger appetite. */
const MAX_RESERVATIONS_PER_POLL = 1000;

/** Builds the env a runner container needs from its template and minted token. */
export type RunnerEnvFactory<Spec> = (args: {
  template: ProvisionerTemplate<Spec>;
  registrationToken: string;
}) => Record<string, string>;

export interface ProvisionerTickDeps<Spec> {
  readonly client: ProvisionerClient;
  readonly templates: readonly ProvisionerTemplate<Spec>[];
  readonly tracker: ProvisionedRunnerTracker;
  readonly launch: LaunchRunner<Spec>;
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

  let launchedCount = 0;
  for (const [reservationId, groups] of groupByReservation(planned)) {
    if (deps.signal?.aborted) break;
    launchedCount += await launchReservation(reservationId, groups, deps);
  }

  return {
    stats: response.stats,
    reservationCount: response.reservations.length,
    plannedCount,
    launchedCount,
  };
}

async function launchReservation<Spec>(
  reservationId: string,
  groups: readonly PlannedLaunchGroup<Spec>[],
  deps: ProvisionerTickDeps<Spec>,
): Promise<number> {
  const plannedRunners = groups.flatMap((group) =>
    Array.from({length: group.count}, () => ({
      provisionedRunnerId: newProvisionedRunnerId(),
      template: group.template,
    })),
  );
  const templateById = new Map(
    plannedRunners.map((runner) => [runner.provisionedRunnerId, runner.template]),
  );

  let launched = 0;
  for (const batch of chunk(plannedRunners, deps.registrationTokenBatchSize)) {
    if (deps.signal?.aborted) break;
    let minted: MintRegistrationTokensBatchResponseDto;
    try {
      minted = await deps.client.mintRegistrationTokens({
        reservation_id: reservationId,
        provisioned_runners: batch.map((runner) => ({
          provisioned_runner_id: runner.provisionedRunnerId,
        })),
      });
    } catch (error) {
      // Leave these slots free: the reservation TTL releases the demand and another
      // tick (or another provisioner) can pick it up.
      logger().error({err: error, reservationId}, 'Failed to mint registration tokens');
      continue;
    }

    for (const token of minted.tokens) {
      if (deps.signal?.aborted) break;
      const template = templateById.get(token.provisioned_runner_id);
      if (!template) continue;

      deps.tracker.recordStarting({
        provisionedRunnerId: token.provisioned_runner_id,
        templateKey: template.key,
      });
      try {
        await deps.launch({
          provisionedRunnerId: token.provisioned_runner_id,
          reservationId,
          template,
          registrationToken: token.registration_token,
          registrationTokenExpiresAt: token.expires_at,
          runnerEnv: deps.buildRunnerEnv({template, registrationToken: token.registration_token}),
        });
        launched += 1;
      } catch (error) {
        // The runner is tracked as starting; backend reconciliation (ENG-618) reaps
        // one that never registers. Do not free the slot here on a transient failure.
        logger().error(
          {err: error, provisionedRunnerId: token.provisioned_runner_id},
          'Failed to launch provisioned runner',
        );
      }
    }
  }

  return launched;
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
