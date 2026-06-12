import {setTimeout as setTimeoutPromise} from 'node:timers/promises';
import {logger} from '@shipfox/node-opentelemetry';
import {createLeaseClient, requestJob} from '#api-client.js';
import {config} from '#config.js';
import {startHeartbeatLoop} from '#heartbeat-loop.js';
import {runJobSteps} from '#step-loop.js';
import {prepareWorkspace, resolveWorkspaceRoot, type Workspace} from '#workspace.js';

let running = true;
let shuttingDown = false;
// Module-level so the long-lived SIGINT handler can reach the in-flight job's
// controller; locally-scoped capture isn't possible from a process-global handler.
let currentJobAbortController: AbortController | undefined;

export async function startRunner(): Promise<void> {
  setupSignalHandlers();

  // Fail fast at startup: a dangerous root should crash the process at deploy,
  // not silently fail every job.
  const workspaceRoot = resolveWorkspaceRoot(config);

  logger().info(
    {
      apiUrl: config.SHIPFOX_API_URL,
      pollInterval: config.SHIPFOX_POLL_INTERVAL_MS,
      workspaceRoot,
    },
    'Runner started',
  );

  let currentInterval = config.SHIPFOX_POLL_INTERVAL_MS;

  while (running) {
    try {
      const job = await requestJob();

      if (!job) {
        logger().debug({interval: currentInterval}, 'No jobs available, backing off');
        currentInterval = Math.min(currentInterval * 1.5, config.SHIPFOX_POLL_MAX_INTERVAL_MS);
        await interruptableSleep(currentInterval);
        continue;
      }

      currentInterval = config.SHIPFOX_POLL_INTERVAL_MS;
      logger().info({jobId: job.job_id, runId: job.run_id}, 'Job claimed');

      await runJob(job, workspaceRoot);
    } catch (pollError) {
      logger().error({err: pollError}, 'Poll cycle failed');
      currentInterval = Math.min(currentInterval * 1.5, config.SHIPFOX_POLL_MAX_INTERVAL_MS);
      await interruptableSleep(currentInterval);
    }
  }

  logger().info('Runner stopped');
}

export async function runJob(
  job: Awaited<ReturnType<typeof requestJob>> & object,
  workspaceRoot: string,
): Promise<void> {
  const ac = new AbortController();
  currentJobAbortController = ac;

  const heartbeatLoop = startHeartbeatLoop(job.job_id, ac, {
    intervalMs: config.SHIPFOX_HEARTBEAT_INTERVAL_MS,
    maxStaleMs: config.SHIPFOX_HEARTBEAT_MAX_STALE_MS,
  });

  let workspace: Workspace | undefined;
  try {
    workspace = await prepareWorkspace(job, workspaceRoot);
    const leaseClient = createLeaseClient(job.lease_token);
    await runJobSteps({jobId: job.job_id, leaseClient, signal: ac.signal, cwd: workspace.cwd});
    logger().info({jobId: job.job_id}, 'Job step loop finished');
  } catch (stepLoopError) {
    // Workspace prep failed, retries are exhausted, or a non-retryable error surfaced.
    // Bail this job; the lease expires server-side and the outer poll moves on. Do not
    // re-pull (would re-execute).
    logger().error({err: stepLoopError, jobId: job.job_id}, 'Job step loop failed');
  } finally {
    heartbeatLoop.stop();
    if (currentJobAbortController === ac) currentJobAbortController = undefined;
    // Clean up the per-job workspace on every exit path.
    if (workspace) await workspace.cleanup();
  }
}

function setupSignalHandlers(): void {
  const handleSignal = (signal: string) => {
    if (shuttingDown) {
      logger().info({signal}, 'Second signal received, aborting current job');
      currentJobAbortController?.abort('shutdown');
      // Also exit promptly — the runner loop's interruptableSleep wakes on signals.
      process.exit(1);
    }

    shuttingDown = true;
    running = false;
    logger().info({signal}, 'Shutting down gracefully, waiting for current job to finish...');
  };

  process.on('SIGINT', () => handleSignal('SIGINT'));
  process.on('SIGTERM', () => handleSignal('SIGTERM'));
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
