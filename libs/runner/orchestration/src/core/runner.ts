import {setTimeout as setTimeoutPromise} from 'node:timers/promises';
import {logger} from '@shipfox/node-opentelemetry';
import {
  createLeaseClient,
  HTTPError,
  registerRunnerSession,
  requestJob,
  runnerToken,
} from '@shipfox/runner-protocol';
import {
  cleanupJobLogs,
  cleanupWorkspace,
  jobLogsPath,
  jobWorkspacePath,
  resolveWorkspaceRootFromEnv,
} from '@shipfox/runner-workspace';
import {config} from '#config.js';
import {startHeartbeatLoop} from '#core/heartbeat-loop.js';
import {runJobSteps} from '#core/step-loop.js';

let running = true;
let shuttingDown = false;
// Module-level so the long-lived SIGINT handler can reach the in-flight job's
// controller; locally-scoped capture isn't possible from a process-global handler.
let currentJobAbortController: AbortController | undefined;

export async function startRunner(): Promise<void> {
  setupSignalHandlers();

  // Fail fast at startup: a dangerous root should crash the process at deploy,
  // not silently fail every job.
  const workspaceRoot = resolveWorkspaceRootFromEnv();

  logger().info(
    {
      pollInterval: config.SHIPFOX_POLL_INTERVAL_MS,
      workspaceRoot,
    },
    'Runner started',
  );

  let currentInterval = config.SHIPFOX_POLL_INTERVAL_MS;
  let runnerSession = await registerRunnerSession();
  logger().info({runnerSessionId: runnerSession.session_id}, 'Runner session registered');

  while (running) {
    try {
      const job = await requestJob(runnerSession.session_token);

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
      if (isUnauthorized(pollError)) {
        try {
          runnerSession = await registerRunnerSession();
          logger().info({runnerSessionId: runnerSession.session_id}, 'Runner session refreshed');
          currentInterval = config.SHIPFOX_POLL_INTERVAL_MS;
          continue;
        } catch (registrationError) {
          logger().error({err: registrationError}, 'Runner session refresh failed');
        }
      }
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
  // The path is deterministic, so compute it up front for cleanup on every exit
  // path; the setup step (position 0) creates the directory. An invalid job id is
  // an internal/claim error: bail before starting any per-job resources.
  let cwd: string;
  let logsDir: string;
  try {
    cwd = jobWorkspacePath(job.job_id, workspaceRoot);
    logsDir = jobLogsPath(job.job_id, workspaceRoot);
  } catch (error) {
    logger().error({err: error, jobId: job.job_id}, 'Invalid job id; skipping job');
    return;
  }

  const ac = new AbortController();
  currentJobAbortController = ac;

  const heartbeatLoop = startHeartbeatLoop(job.job_id, job.lease_token, ac, {
    intervalMs: config.SHIPFOX_HEARTBEAT_INTERVAL_MS,
    maxStaleMs: config.SHIPFOX_HEARTBEAT_MAX_STALE_MS,
  });

  try {
    const leaseClient = createLeaseClient(job.lease_token);
    // Both runner credentials can reach a step's environment, so scrub them from
    // captured output before it touches the spool.
    const secrets = [runnerToken(), job.lease_token];
    await runJobSteps({
      jobId: job.job_id,
      leaseClient,
      secrets,
      signal: ac.signal,
      cwd,
      logsDir,
      jobContext: {jobId: job.job_id, runId: job.run_id},
    });
    logger().info({jobId: job.job_id}, 'Job step loop finished');
  } catch (stepLoopError) {
    // A non-retryable error surfaced (e.g. an unexpected throw from the loop).
    // Bail this job; the lease expires server-side and the outer poll moves on.
    // Do not re-pull (would re-execute). Setup failures do NOT reach here — they
    // report through the step protocol and finalize the job.
    logger().error({err: stepLoopError, jobId: job.job_id}, 'Job step loop failed');
  } finally {
    heartbeatLoop.stop();
    if (currentJobAbortController === ac) currentJobAbortController = undefined;
    await cleanupWorkspace(cwd);
    await cleanupJobLogs(logsDir);
  }
}

function isUnauthorized(error: unknown): boolean {
  return error instanceof HTTPError && error.response.status === 401;
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
