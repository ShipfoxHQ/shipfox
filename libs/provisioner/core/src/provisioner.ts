import {setTimeout as setTimeoutPromise} from 'node:timers/promises';
import {logger} from '@shipfox/node-opentelemetry';
import {
  createProvisionerClient,
  ProvisionerAuthenticationError,
  type ProvisionerClient,
} from '#api-client.js';
import {config} from '#config.js';
import {type RunnerEnvFactory, runProvisionerTick} from '#tick.js';
import {createInMemoryTracker, type ProvisionedRunnerTracker} from '#tracker.js';
import type {ProvisionerAdapter, ProvisionerTemplate} from '#types.js';

/** The demand poll accepts at most 100 advertised templates per request. */
const MAX_TEMPLATES_PER_POLL = 100;

let running = true;
let shuttingDown = false;
let signalHandlersRegistered = false;
// Module-level so the long-lived signal handler can cancel the in-flight long-poll;
// a locally-scoped capture isn't reachable from a process-global handler.
let pollAbortController: AbortController | undefined;

export interface StartProvisionerOptions<Spec> {
  readonly adapter: ProvisionerAdapter<Spec>;
}

export interface RunProvisionerIterationDeps<Spec> {
  readonly adapter: ProvisionerAdapter<Spec>;
  readonly client: ProvisionerClient;
  readonly templates: readonly ProvisionerTemplate<Spec>[];
  readonly tracker: ProvisionedRunnerTracker;
  readonly currentInterval: number;
  readonly degraded: boolean;
  readonly signal?: AbortSignal;
}

export interface RunProvisionerIterationResult {
  readonly nextInterval: number;
  readonly degraded: boolean;
}

/**
 * Run the provisioner control loop until a shutdown signal: authenticate, load the
 * provider's templates once, then repeatedly poll demand, plan launches, mint tokens,
 * and start runners through the provider's launcher. Backs off on error and aborts the
 * in-flight long-poll on SIGINT/SIGTERM so shutdown is prompt.
 */
export async function startProvisioner<Spec>(
  options: StartProvisionerOptions<Spec>,
): Promise<void> {
  running = true;
  shuttingDown = false;
  setupSignalHandlers();

  const templates = await options.adapter.loadTemplates();
  if (templates.length === 0) {
    throw new Error('Provisioner started with no templates; configure at least one template.');
  }
  if (templates.length > MAX_TEMPLATES_PER_POLL) {
    // The demand poll advertises every template at once and the API caps that list, so a
    // larger set would fail schema validation on every poll. Fail fast instead.
    throw new Error(
      `Provisioner has ${templates.length} templates; the demand poll accepts at most ${MAX_TEMPLATES_PER_POLL}. Reduce the configured templates.`,
    );
  }

  const client = createProvisionerClient({
    baseUrl: config.SHIPFOX_API_URL,
    token: config.SHIPFOX_PROVISIONER_TOKEN,
  });

  // Fail fast at startup if the token is rejected, rather than discovering it on the
  // first poll.
  const identity = await client.getIdentity();
  logger().info(
    {
      provisionerId: identity.id,
      workspaceId: identity.workspace_id,
      templateCount: templates.length,
    },
    'Provisioner authenticated',
  );

  const tracker = createInMemoryTracker();
  let degraded = false;
  try {
    await options.adapter.onStart?.({
      client,
      identity: {id: identity.id, workspaceId: identity.workspace_id},
      tracker,
    });
  } catch (error) {
    degraded = true;
    logger().error(
      {err: error},
      'Provisioner startup reconciliation failed; advertising no free capacity until observe succeeds',
    );
  }

  let currentInterval = config.SHIPFOX_PROVISIONER_POLL_INTERVAL_MS;

  while (running) {
    pollAbortController = new AbortController();
    try {
      const iteration: RunProvisionerIterationResult = await runProvisionerIteration({
        adapter: options.adapter,
        client,
        templates,
        tracker,
        currentInterval,
        degraded,
        signal: pollAbortController.signal,
      });
      currentInterval = iteration.nextInterval;
      degraded = iteration.degraded;
      await interruptableSleep(withJitter(currentInterval));
    } catch (error) {
      if (!running) break;
      if (error instanceof ProvisionerAuthenticationError) {
        // Distinct from a transient blip: the token was rejected. Keep retrying (it may be
        // rotated back) but make the cause obvious to an operator reading the logs.
        logger().error(
          {err: error},
          'Provisioner token rejected; retrying after backoff (verify the token is valid and not revoked)',
        );
      } else {
        logger().error({err: error}, 'Provisioner tick failed');
      }
      currentInterval = nextBackoffInterval(currentInterval);
      await interruptableSleep(withJitter(currentInterval));
    }
  }

  await options.adapter.onStop?.();
  logger().info('Provisioner stopped');
}

export async function runProvisionerIteration<Spec>(
  deps: RunProvisionerIterationDeps<Spec>,
): Promise<RunProvisionerIterationResult> {
  let degraded = deps.degraded;
  let maxReservations = config.SHIPFOX_PROVISIONER_MAX_RESERVATIONS;

  try {
    if (deps.adapter.onTick) {
      await deps.adapter.onTick();
      degraded = false;
    }
  } catch (error) {
    degraded = true;
    maxReservations = 0;
    logger().error(
      {err: error},
      'Provisioner observe failed; advertising no free capacity until observe succeeds',
    );
  }

  if (degraded) maxReservations = 0;

  const result = await runProvisionerTick({
    client: deps.client,
    templates: deps.templates,
    tracker: deps.tracker,
    launch: deps.adapter.launch,
    buildRunnerEnv,
    maxReservations,
    waitSeconds: config.SHIPFOX_PROVISIONER_POLL_WAIT_SECONDS,
    registrationTokenBatchSize: config.SHIPFOX_PROVISIONER_REGISTRATION_TOKEN_BATCH_SIZE,
    ...(deps.signal ? {signal: deps.signal} : {}),
  });

  if (result.reservationCount > 0 || result.launchedCount > 0) {
    logger().info(
      {
        reservations: result.reservationCount,
        planned: result.plannedCount,
        launchAttempts: result.launchAttemptedCount,
        launched: result.launchedCount,
      },
      'Provisioner tick complete',
    );
  }

  const allAttemptedLaunchesFailed = result.launchAttemptedCount > 0 && result.launchedCount === 0;
  const shouldBackOff = degraded || allAttemptedLaunchesFailed;

  if (allAttemptedLaunchesFailed) {
    logger().warn(
      {attempted: result.launchAttemptedCount},
      'All attempted provisioned runner launches failed; backing off',
    );
  }

  return {
    nextInterval: shouldBackOff
      ? nextBackoffInterval(deps.currentInterval)
      : config.SHIPFOX_PROVISIONER_POLL_INTERVAL_MS,
    degraded,
  };
}

export const buildRunnerEnv: RunnerEnvFactory<unknown> = ({template, registrationToken}) => ({
  SHIPFOX_API_URL: config.SHIPFOX_RUNNER_API_URL ?? config.SHIPFOX_API_URL,
  SHIPFOX_RUNNER_TOKEN: registrationToken,
  SHIPFOX_RUNNER_LABELS: template.labels.join(','),
  SHIPFOX_POLL_MAX_DURATION_MS: String(config.SHIPFOX_RUNNER_POLL_MAX_DURATION_MS),
});

export function nextBackoffInterval(ms: number): number {
  return Math.min(ms * 1.5, config.SHIPFOX_PROVISIONER_POLL_MAX_INTERVAL_MS);
}

export function withJitter(ms: number): number {
  // Keep a floor of half the interval so a fast-returning poll (for example with
  // wait_seconds=0) cannot collapse the delay toward zero and busy-loop the API.
  return ms * (0.5 + Math.random() * 0.5);
}

function setupSignalHandlers(): void {
  if (signalHandlersRegistered) return;

  process.on('SIGINT', handleSigint);
  process.on('SIGTERM', handleSigterm);
  signalHandlersRegistered = true;
}

function handleSigint(): void {
  handleSignal('SIGINT');
}

function handleSigterm(): void {
  handleSignal('SIGTERM');
}

function handleSignal(signal: string): void {
  if (shuttingDown) {
    logger().info({signal}, 'Second signal received, exiting now');
    process.exit(1);
  }

  shuttingDown = true;
  running = false;
  logger().info({signal}, 'Shutting down gracefully');
  // Cancel the in-flight long-poll so the loop wakes without waiting out wait_seconds.
  pollAbortController?.abort('shutdown');
}

async function interruptableSleep(ms: number): Promise<void> {
  const ac = new AbortController();
  const onStop = () => ac.abort();

  if (!running) return;

  process.once('SIGINT', onStop);
  process.once('SIGTERM', onStop);

  try {
    await setTimeoutPromise(ms, undefined, {signal: ac.signal});
  } catch {
    // AbortError from signal interruption — expected
  } finally {
    process.removeListener('SIGINT', onStop);
    process.removeListener('SIGTERM', onStop);
  }
}
