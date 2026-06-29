import {setTimeout as setTimeoutPromise} from 'node:timers/promises';
import {logger} from '@shipfox/node-opentelemetry';
import {createProvisionerClient, ProvisionerAuthenticationError} from '#api-client.js';
import {config} from '#config.js';
import {runProvisionerTick} from '#tick.js';
import {createInMemoryTracker} from '#tracker.js';
import type {ProvisionerAdapter} from '#types.js';

let running = true;
let shuttingDown = false;
let signalHandlersRegistered = false;
// Module-level so the long-lived signal handler can cancel the in-flight long-poll;
// a locally-scoped capture isn't reachable from a process-global handler.
let pollAbortController: AbortController | undefined;

export interface StartProvisionerOptions<Spec> {
  readonly adapter: ProvisionerAdapter<Spec>;
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
  let currentInterval = config.SHIPFOX_PROVISIONER_POLL_INTERVAL_MS;

  while (running) {
    pollAbortController = new AbortController();
    try {
      const result = await runProvisionerTick({
        client,
        templates,
        tracker,
        launch: options.adapter.launch,
        buildRunnerEnv: ({template, registrationToken}) => ({
          SHIPFOX_API_URL: config.SHIPFOX_API_URL,
          SHIPFOX_RUNNER_TOKEN: registrationToken,
          SHIPFOX_RUNNER_LABELS: template.labels.join(','),
          SHIPFOX_POLL_MAX_DURATION_MS: String(config.SHIPFOX_RUNNER_POLL_MAX_DURATION_MS),
        }),
        maxReservations: config.SHIPFOX_PROVISIONER_MAX_RESERVATIONS,
        waitSeconds: config.SHIPFOX_PROVISIONER_POLL_WAIT_SECONDS,
        registrationTokenBatchSize: config.SHIPFOX_PROVISIONER_REGISTRATION_TOKEN_BATCH_SIZE,
        signal: pollAbortController.signal,
      });

      if (result.reservationCount > 0 || result.launchedCount > 0) {
        logger().info(
          {
            reservations: result.reservationCount,
            planned: result.plannedCount,
            launched: result.launchedCount,
          },
          'Provisioner tick complete',
        );
      }

      currentInterval = config.SHIPFOX_PROVISIONER_POLL_INTERVAL_MS;
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

  logger().info('Provisioner stopped');
}

export function nextBackoffInterval(ms: number): number {
  return Math.min(ms * 1.5, config.SHIPFOX_PROVISIONER_POLL_MAX_INTERVAL_MS);
}

export function withJitter(ms: number): number {
  return Math.random() * ms;
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
