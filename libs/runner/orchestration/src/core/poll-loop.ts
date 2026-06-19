import {setTimeout as setTimeoutPromise} from 'node:timers/promises';
import type {ClaimedJobResponseDto} from '@shipfox/api-runners-dto';
import {logger} from '@shipfox/node-opentelemetry';
import type {RunnerProtocol} from '@shipfox/runner-protocol/contract';
import {cleanupWorkspace, jobWorkspacePath} from '@shipfox/runner-workspace';
import {config} from '#config.js';
import {startHeartbeatLoop} from '#core/heartbeat-loop.js';
import {runJobSteps} from '#core/step-loop.js';

export interface HeartbeatTiming {
  intervalMs: number;
  maxStaleMs: number;
}

export interface RunJobDeps {
  protocol: RunnerProtocol;
  /** Heartbeat timing; defaults to config. Tests pass short intervals. */
  heartbeat?: HeartbeatTiming | undefined;
  /**
   * Registers the per-job AbortController so the shutdown handler (and abort tests)
   * can reach the in-flight job. Called with the controller on start and `undefined`
   * on exit.
   */
  registerJobController?: ((controller: AbortController | undefined) => void) | undefined;
}

export async function runJob(
  job: ClaimedJobResponseDto,
  workspaceRoot: string,
  deps: RunJobDeps,
): Promise<void> {
  // The path is deterministic, so compute it up front for cleanup on every exit
  // path; the setup step (position 0) creates the directory. An invalid job id is
  // an internal/claim error: bail before starting any per-job resources.
  let cwd: string;
  try {
    cwd = jobWorkspacePath(job.job_id, workspaceRoot);
  } catch (error) {
    logger().error({err: error, jobId: job.job_id}, 'Invalid job id; skipping job');
    return;
  }

  const ac = new AbortController();
  deps.registerJobController?.(ac);

  const timing = deps.heartbeat ?? {
    intervalMs: config.SHIPFOX_HEARTBEAT_INTERVAL_MS,
    maxStaleMs: config.SHIPFOX_HEARTBEAT_MAX_STALE_MS,
  };
  const heartbeatLoop = startHeartbeatLoop(
    job.job_id,
    ac,
    {intervalMs: timing.intervalMs, maxStaleMs: timing.maxStaleMs},
    {heartbeat: (id, options) => deps.protocol.heartbeat(id, options)},
  );

  try {
    const lease = deps.protocol.forJob(job.lease_token);
    await runJobSteps({jobId: job.job_id, lease, signal: ac.signal, cwd});
    logger().info({jobId: job.job_id}, 'Job step loop finished');
  } catch (stepLoopError) {
    // A non-retryable error surfaced (e.g. an unexpected throw from the loop, or a
    // rejected report). Bail this job; the lease expires server-side and the outer
    // poll moves on. Do not re-pull (would re-execute).
    logger().error({err: stepLoopError, jobId: job.job_id}, 'Job step loop failed');
  } finally {
    heartbeatLoop.stop();
    deps.registerJobController?.(undefined);
    // Clean up the per-job workspace on every exit path.
    await cleanupWorkspace(cwd);
  }
}

export interface RunPollLoopDeps {
  protocol: RunnerProtocol;
  workspaceRoot: string;
  /** Aborts to stop claiming new jobs; the in-flight job is left to finish. */
  pollSignal: AbortSignal;
  pollIntervalMs: number;
  maxIntervalMs: number;
  heartbeat?: HeartbeatTiming | undefined;
  registerJobController?: ((controller: AbortController | undefined) => void) | undefined;
}

/**
 * Claims and runs jobs until `pollSignal` aborts. The per-job AbortController is
 * owned by {@link runJob}; this loop never aborts the in-flight job, so a graceful
 * shutdown (pollSignal abort) lets the current job finish before the loop exits.
 */
export async function runPollLoop(deps: RunPollLoopDeps): Promise<void> {
  let currentInterval = deps.pollIntervalMs;

  while (!deps.pollSignal.aborted) {
    try {
      const job = await deps.protocol.requestJob({signal: deps.pollSignal});

      if (!job) {
        logger().debug({interval: currentInterval}, 'No jobs available, backing off');
        currentInterval = Math.min(currentInterval * 1.5, deps.maxIntervalMs);
        await backoff(currentInterval, deps.pollSignal);
        continue;
      }

      currentInterval = deps.pollIntervalMs;
      logger().info({jobId: job.job_id, runId: job.run_id}, 'Job claimed');

      await runJob(job, deps.workspaceRoot, {
        protocol: deps.protocol,
        heartbeat: deps.heartbeat,
        registerJobController: deps.registerJobController,
      });
    } catch (pollError) {
      if (deps.pollSignal.aborted) return;
      logger().error({err: pollError}, 'Poll cycle failed');
      currentInterval = Math.min(currentInterval * 1.5, deps.maxIntervalMs);
      await backoff(currentInterval, deps.pollSignal);
    }
  }
}

async function backoff(ms: number, signal: AbortSignal): Promise<void> {
  try {
    await setTimeoutPromise(ms, undefined, {signal});
  } catch {
    // AbortError when the poll signal fires during backoff — expected.
  }
}
