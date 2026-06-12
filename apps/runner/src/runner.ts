import {setTimeout as setTimeoutPromise} from 'node:timers/promises';
import {logger} from '@shipfox/node-opentelemetry';
import {completeJob, HTTPError, requestJob} from '#api-client.js';
import {config} from '#config.js';
import {type ExecuteJobResult, executeJob} from '#executor.js';
import {startHeartbeatLoop} from '#heartbeat-loop.js';
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
      logger().info(
        {jobId: job.job_id, jobName: job.job_name, steps: job.steps.length},
        'Job received',
      );

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
  let result: ExecuteJobResult;
  try {
    workspace = await prepareWorkspace(job, workspaceRoot);
    result = await executeJob(job, {signal: ac.signal, cwd: workspace.cwd});
    logger().info({jobId: job.job_id, status: result.status}, 'Job execution finished');
  } catch (execError) {
    logger().error({err: execError, jobId: job.job_id}, 'Job execution failed');
    // Empty steps[] tells the API "we don't know which step crashed"; the
    // workflow falls back to bulk-failing every step.
    result = {status: 'failed', steps: []};
  } finally {
    heartbeatLoop.stop();
    if (currentJobAbortController === ac) currentJobAbortController = undefined;
  }

  try {
    // 404 here is the expected signal that the backend already finalized this
    // job; do not retry, do not fall through to the outer catch (would re-attempt).
    await completeJob({jobId: job.job_id, status: result.status, steps: result.steps});
    logger().info({jobId: job.job_id, status: result.status}, 'Job completed');
  } catch (reportError) {
    if (reportError instanceof HTTPError && reportError.response.status === 404) {
      logger().info(
        {jobId: job.job_id},
        'Backend already finalized this job; skipping completion report',
      );
    } else {
      logger().error({err: reportError, jobId: job.job_id}, 'Failed to report job completion');
    }
  } finally {
    // Clean up after reporting so a slow cleanup can't lose the completion.
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
