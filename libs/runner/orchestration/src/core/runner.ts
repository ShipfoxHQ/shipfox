import {setTimeout as setTimeoutPromise} from 'node:timers/promises';
import {logger} from '@shipfox/node-opentelemetry';
import {
  createLeaseClient,
  HTTPError,
  RunnerSessionExhaustedError,
  registerRunnerSession,
  requestJob,
  requireRunnerLabels,
  runnerRegistrationToken,
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
let signalHandlersRegistered = false;
// Module-level so the long-lived SIGINT handler can reach the in-flight job's
// controller; locally-scoped capture isn't possible from a process-global handler.
let currentJobAbortController: AbortController | undefined;
type RunnerSession = Awaited<ReturnType<typeof registerRunnerSession>>;

export async function startRunner(): Promise<void> {
  running = true;
  shuttingDown = false;
  setupSignalHandlers();

  // Fail fast at startup: a dangerous root should crash the process at deploy,
  // not silently fail every job.
  const workspaceRoot = resolveWorkspaceRootFromEnv();
  requireRunnerLabels();

  logger().info(
    {
      pollInterval: config.SHIPFOX_POLL_INTERVAL_MS,
      pollMaxDuration: config.SHIPFOX_POLL_MAX_DURATION_MS,
      workspaceRoot,
    },
    'Runner started',
  );

  let currentInterval = config.SHIPFOX_POLL_INTERVAL_MS;
  let runnerSession: RunnerSession | undefined;

  await interruptableSleep(withJitter(config.SHIPFOX_POLL_INTERVAL_MS));
  let pollDeadline = nextPollDeadline();

  while (running) {
    try {
      if (!runnerSession) {
        runnerSession = await registerRunnerSession();
        logger().info({runnerSessionId: runnerSession.session_id}, 'Runner session registered');
      }

      const job = await requestJob(runnerSession.session_token);

      if (!job) {
        if (hasPollDeadlinePassed(pollDeadline)) {
          logger().info('No jobs available before the poll deadline; runner exiting');
          return;
        }
        currentInterval = nextBackoffInterval(currentInterval);
        logger().debug({interval: currentInterval}, 'No jobs available, backing off');
        await interruptableSleep(withJitter(currentInterval));
        continue;
      }

      logger().info(
        {
          workflowRunId: job.workflow_run_id,
          workflowRunAttemptId: job.workflow_run_attempt_id,
          jobId: job.job_id,
          jobExecutionId: job.job_execution_id,
        },
        'Job claimed',
      );

      await runJob(job, workspaceRoot);
      currentInterval = config.SHIPFOX_POLL_INTERVAL_MS;
      pollDeadline = nextPollDeadline();
    } catch (pollError) {
      if (isUnauthorized(pollError)) {
        runnerSession = undefined;
        logger().info('Runner session rejected; registering a new session');
        if (hasPollDeadlinePassed(pollDeadline)) {
          logger().error({err: pollError}, 'Runner session rejected past the poll deadline');
          throw pollError;
        }
        currentInterval = nextBackoffInterval(currentInterval);
        await interruptableSleep(withJitter(currentInterval));
        continue;
      }
      if (pollError instanceof RunnerSessionExhaustedError) {
        logger().info('Runner session exhausted; runner exiting');
        return;
      }
      if (hasPollDeadlinePassed(pollDeadline)) {
        logger().error({err: pollError}, 'Poll cycle failed past the poll deadline');
        throw pollError;
      }
      logger().error({err: pollError}, 'Poll cycle failed');
      currentInterval = nextBackoffInterval(currentInterval);
      await interruptableSleep(withJitter(currentInterval));
    }
  }

  logger().info('Runner stopped');
}

export function nextBackoffInterval(ms: number): number {
  return Math.min(ms * 1.5, config.SHIPFOX_POLL_MAX_INTERVAL_MS);
}

export function withJitter(ms: number): number {
  return Math.random() * ms;
}

export function nextPollDeadline(): number | undefined {
  if (config.SHIPFOX_POLL_MAX_DURATION_MS === 0) return undefined;
  return Date.now() + config.SHIPFOX_POLL_MAX_DURATION_MS;
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

  const runnerSecret = runnerRegistrationToken();
  const initialLeaseToken = job.lease_token;
  let currentLeaseToken = initialLeaseToken;
  let previousRenewedLeaseToken: string | undefined;
  let currentRenewedLeaseToken: string | undefined;
  const secrets = [runnerSecret, initialLeaseToken];
  const leaseTokenSecretSubscribers = new Set<(secrets: string[]) => void>();
  const rotatingLeaseSecrets = () =>
    [previousRenewedLeaseToken, currentRenewedLeaseToken].filter(
      (secret): secret is string => secret !== undefined,
    );
  const rememberLeaseToken = (leaseToken: string) => {
    if (leaseToken === currentLeaseToken) return;
    previousRenewedLeaseToken = currentRenewedLeaseToken;
    currentRenewedLeaseToken = leaseToken;
    currentLeaseToken = leaseToken;
    secrets.splice(0, secrets.length, runnerSecret, initialLeaseToken, ...rotatingLeaseSecrets());
    for (const subscriber of leaseTokenSecretSubscribers) subscriber(rotatingLeaseSecrets());
  };

  const heartbeatLoop = startHeartbeatLoop(job.job_id, () => currentLeaseToken, ac, {
    intervalMs: config.SHIPFOX_HEARTBEAT_INTERVAL_MS,
    maxStaleMs: config.SHIPFOX_HEARTBEAT_MAX_STALE_MS,
    onLeaseTokenRenewed: rememberLeaseToken,
  });

  try {
    const leaseClient = createLeaseClient(() => currentLeaseToken);
    await runJobSteps({
      jobId: job.job_id,
      leaseClient,
      secrets,
      subscribeSecrets: (subscriber) => {
        leaseTokenSecretSubscribers.add(subscriber);
        return () => leaseTokenSecretSubscribers.delete(subscriber);
      },
      signal: ac.signal,
      cwd,
      logsDir,
      jobContext: {
        workflowRunId: job.workflow_run_id,
        workflowRunAttemptId: job.workflow_run_attempt_id,
        jobId: job.job_id,
        jobExecutionId: job.job_execution_id,
      },
      onLeaseTokenAdopted: (leaseToken) => {
        rememberLeaseToken(leaseToken);
        heartbeatLoop.bumpGeneration();
      },
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

function hasPollDeadlinePassed(deadline: number | undefined): boolean {
  return deadline !== undefined && Date.now() >= deadline;
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
    logger().info({signal}, 'Second signal received, aborting current job');
    currentJobAbortController?.abort('shutdown');
    // Also exit promptly — the runner loop's interruptableSleep wakes on signals.
    process.exit(1);
  }

  shuttingDown = true;
  running = false;
  logger().info({signal}, 'Shutting down gracefully, waiting for current job to finish...');
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
