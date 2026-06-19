import {logger} from '@shipfox/node-opentelemetry';
import type {RunnerProtocol} from '@shipfox/runner-protocol/contract';
import {resolveWorkspaceRootFromEnv} from '@shipfox/runner-workspace';
import {config} from '#config.js';
import {runPollLoop} from '#core/poll-loop.js';

export interface StartRunnerOptions {
  /** The protocol client the runner talks to. The app composes the configured default. */
  protocol: RunnerProtocol;
  /** Defaults to resolveWorkspaceRootFromEnv(); injected by tests. */
  workspaceRoot?: string | undefined;
}

let shuttingDown = false;
// Two separate signals (see core/poll-loop.ts): the first SIGINT/SIGTERM aborts the
// poll-stop controller so the runner stops claiming and lets the current job finish;
// the second aborts the in-flight job's controller and exits. Module-level so the
// long-lived signal handlers can reach them.
const pollAbortController = new AbortController();
let currentJobAbortController: AbortController | undefined;

export async function startRunner(options: StartRunnerOptions): Promise<void> {
  setupSignalHandlers();

  // Fail fast at startup: a dangerous root should crash the process at deploy,
  // not silently fail every job.
  const workspaceRoot = options.workspaceRoot ?? resolveWorkspaceRootFromEnv();

  logger().info({pollInterval: config.SHIPFOX_POLL_INTERVAL_MS, workspaceRoot}, 'Runner started');

  await runPollLoop({
    protocol: options.protocol,
    workspaceRoot,
    pollSignal: pollAbortController.signal,
    pollIntervalMs: config.SHIPFOX_POLL_INTERVAL_MS,
    maxIntervalMs: config.SHIPFOX_POLL_MAX_INTERVAL_MS,
    registerJobController: (controller) => {
      currentJobAbortController = controller;
    },
  });

  logger().info('Runner stopped');
}

function setupSignalHandlers(): void {
  const handleSignal = (signal: string) => {
    if (shuttingDown) {
      logger().info({signal}, 'Second signal received, aborting current job');
      currentJobAbortController?.abort('shutdown');
      // Exit promptly — the poll loop's backoff wakes on the poll signal.
      process.exit(1);
    }

    shuttingDown = true;
    pollAbortController.abort('shutdown');
    logger().info({signal}, 'Shutting down gracefully, waiting for current job to finish...');
  };

  process.on('SIGINT', () => handleSignal('SIGINT'));
  process.on('SIGTERM', () => handleSignal('SIGTERM'));
}
