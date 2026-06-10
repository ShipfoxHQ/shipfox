import {setTimeout as setTimeoutPromise} from 'node:timers/promises';
import {logger} from '@shipfox/node-opentelemetry';
import {requestJob} from '#api-client.js';
import {config} from '#config.js';
import {executeJob} from '#executor.js';
import {startHeartbeatLoop} from '#heartbeat-loop.js';

let running = true;
let shuttingDown = false;
// Module-level so the long-lived SIGINT handler can reach the in-flight job's
// controller; locally-scoped capture isn't possible from a process-global handler.
let currentJobAbortController: AbortController | undefined;

export async function startRunner(): Promise<void> {
  setupSignalHandlers();

  logger().info(
    {apiUrl: config.SHIPFOX_API_URL, pollInterval: config.SHIPFOX_POLL_INTERVAL_MS},
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
      logger().info({jobId: job.job_id}, 'Job received');

      await runJob(job);
    } catch (pollError) {
      logger().error({err: pollError}, 'Poll cycle failed');
      currentInterval = Math.min(currentInterval * 1.5, config.SHIPFOX_POLL_MAX_INTERVAL_MS);
      await interruptableSleep(currentInterval);
    }
  }

  logger().info('Runner stopped');
}

async function runJob(job: Awaited<ReturnType<typeof requestJob>> & object): Promise<void> {
  const ac = new AbortController();
  currentJobAbortController = ac;

  const heartbeatLoop = startHeartbeatLoop(job.job_id, ac, {
    intervalMs: config.SHIPFOX_HEARTBEAT_INTERVAL_MS,
    maxStaleMs: config.SHIPFOX_HEARTBEAT_MAX_STALE_MS,
  });

  try {
    const result = await executeJob({leaseToken: job.lease_token}, {signal: ac.signal});
    logger().info({jobId: job.job_id, status: result.status}, 'Job execution finished');
  } catch (execError) {
    // A pull/report failed (e.g. network) or the job was aborted mid-step.
    // Per-step results already persisted are authoritative, and a job the runner
    // abandons is reclaimed by the server-side job timeout — nothing to report.
    logger().error({err: execError, jobId: job.job_id}, 'Job execution failed');
  } finally {
    heartbeatLoop.stop();
    if (currentJobAbortController === ac) currentJobAbortController = undefined;
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
