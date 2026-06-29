import type {LogOutcomeDto, NextStepResponseDto, StepDto} from '@shipfox/api-workflows-dto';
import {logger} from '@shipfox/node-opentelemetry';
import {executeAgentStep} from '@shipfox/runner-agent';
import {
  type CommandStartMetadata,
  executeRunStep,
  executeSetupStep,
  type SetupJobContext,
  type StepResult,
} from '@shipfox/runner-execution';
import {
  createSessionLogStream,
  createStepLogStream,
  type LogDrainOutcome,
  type LogStreamLifecycle,
  type SessionLogStream,
  type StepLogStream,
} from '@shipfox/runner-logs';
import {
  AgentRuntimeConfigRequestError,
  appendStepLogs,
  HTTPError,
  type LogAppendFn,
  reportStep,
  requestAgentRuntimeConfig,
  requestNextStep,
} from '@shipfox/runner-protocol';
import type {KyInstance} from 'ky';

const WHITESPACE_REGEX = /\s+/;

// Reporting a step before pulling the next one is the safety invariant: a lost report is
// retried in place (next/report are idempotent), so a step is never re-pulled or
// re-executed. The per-attempt log stream is settled before that report so the server can
// close the durable stream immediately from the reported log outcome.
//
// Each step gets a per-attempt log stream: capture -> spool -> upload. The prior
// attempt's stream is drained and disposed before the report, and the `finally`
// drains an aborted last one (bounded) before runJob deletes the runner-owned spool directory.
export async function runJobSteps(params: {
  jobId: string;
  leaseClient: KyInstance;
  /** Secrets masked out of captured output before it reaches the spool. */
  secrets: string[];
  signal: AbortSignal;
  cwd: string;
  logsDir: string;
  jobContext: SetupJobContext;
}): Promise<void> {
  const {jobId, leaseClient, secrets, signal, cwd, logsDir, jobContext} = params;

  // The setup step prepares the workspace; every run step assumes it ran. A run
  // step pulled before a successful setup is failed cleanly rather than spawned
  // against an unprepared cwd.
  let workspacePrepared = false;

  // The most recent step's stream, kept until the next
  // iteration settles it (or the finally does at job end). The step loop is sequential, so
  // at most one tail drains.
  let activeStream: LogStreamLifecycle | undefined;

  try {
    while (!signal.aborted) {
      // Idempotent cleanup for abort/error paths; the normal report path settles and clears
      // activeStream before the next iteration reaches this point.
      await settleStream({stream: activeStream, signal});
      activeStream = undefined;

      const pulled = await pullNextStep({leaseClient, jobId, signal});
      if (!pulled) return;
      if (signal.aborted) return;

      const {step, attempt} = pulled;
      const stepLabel = step.name ?? `step #${step.position}`;
      logger().info(
        {jobId, stepId: step.id, stepName: step.name, position: step.position, attempt},
        `Running ${stepLabel}`,
      );

      const execution = await executeStep({
        step,
        attempt,
        cwd,
        leaseClient,
        secrets,
        signal,
        workspacePrepared,
        jobId,
        stepLabel,
        logsDir,
        jobContext,
      });
      activeStream = execution.stream;
      if (execution.preparedWorkspace) workspacePrepared = true;

      if (signal.aborted) return;

      const logOutcome =
        (await settleStream({stream: activeStream, signal})) ?? execution.logOutcome ?? 'drained';
      activeStream = undefined;

      const {cancel} = await reportStepResult({
        leaseClient,
        step,
        attempt,
        result: execution.result,
        logOutcome,
        jobId,
        stepLabel,
        signal,
      });
      if (cancel) {
        logger().info(
          {jobId, stepId: step.id},
          'Job finished without full success; stopping step loop',
        );
        return;
      }
    }
  } finally {
    // Drain the last stream (bounded) before runJob deletes the log spool; an abort
    // cuts the wait short. Whatever did not drain is timeout-closed server-side.
    await settleStream({stream: activeStream, signal});
  }
}

export interface PulledStep {
  step: StepDto;
  attempt: number;
}

// Pulls the next step, translating the loop's two quiet stop conditions into `undefined`:
// a 404 (the lease no longer maps to a job) and a `done` response. Any other error
// propagates so the loop bails without re-pulling.
export async function pullNextStep(params: {
  leaseClient: KyInstance;
  jobId: string;
  signal: AbortSignal;
}): Promise<PulledStep | undefined> {
  const {leaseClient, jobId, signal} = params;

  let next: NextStepResponseDto;
  try {
    next = await requestNextStep(leaseClient, {signal});
  } catch (error) {
    if (error instanceof HTTPError && error.response.status === 404) {
      logger().info({jobId}, 'No job for this lease (404); stopping step loop');
      return undefined;
    }
    throw error;
  }

  if (next.kind === 'done') {
    logger().info({jobId, status: next.status}, 'No more steps; stopping step loop');
    return undefined;
  }

  return {step: next.step, attempt: next.attempt};
}

export interface StepExecution {
  result: StepResult;
  stream?: LogStreamLifecycle | undefined;
  logOutcome?: LogOutcomeDto | undefined;
  /** True when a setup step succeeded, unlocking the run steps that follow it. */
  preparedWorkspace: boolean;
}

// Runs one step and always yields a StepResult, never throws: a crash before a result
// exists (e.g. writing the temp script) becomes a reported failure so the step does not
// hang `running`. The log stream is returned even on a
// throw, so the caller can still settle it.
export async function executeStep(params: {
  step: StepDto;
  attempt: number;
  cwd: string;
  logsDir: string;
  jobContext: SetupJobContext;
  leaseClient: KyInstance;
  secrets: string[];
  signal: AbortSignal;
  workspacePrepared: boolean;
  jobId: string;
  stepLabel: string;
}): Promise<StepExecution> {
  const {
    step,
    attempt,
    cwd,
    logsDir,
    jobContext,
    leaseClient,
    secrets,
    signal,
    workspacePrepared,
    jobId,
    stepLabel,
  } = params;

  let stream: LogStreamLifecycle | undefined;
  let runStream: StepLogStream | undefined;
  try {
    // Both step kinds capture to the same per-attempt stream contract (one stream per
    // job/step/attempt). The append port is bound to the lease client, step, and attempt.
    const append: LogAppendFn = ({offset, body, signal: appendSignal}) =>
      appendStepLogs(leaseClient, {
        stepId: step.id,
        attempt,
        offset,
        body,
        ...(appendSignal ? {signal: appendSignal} : {}),
      });

    if (step.type === 'setup') {
      let setupStream: StepLogStream | undefined;
      try {
        setupStream = createStepLogStream({
          logsDir,
          stepId: step.id,
          attempt,
          secrets,
          append,
        });
      } catch (error) {
        logger().error(
          {err: error, jobId, stepId: step.id, attempt},
          'Failed to open setup log capture; running setup without it',
        );
      }
      stream = setupStream;

      const result = await executeSetupStep({
        cwd,
        leaseClient,
        signal,
        ...(setupStream ? {log: setupStream} : {}),
        jobContext,
      });
      return {
        result,
        stream,
        logOutcome: setupStream ? undefined : 'abandoned',
        preparedWorkspace: result.success,
      };
    }

    if (!workspacePrepared) {
      // Invariant violation (a run or agent step before setup prepared the cwd), not a
      // setup-phase failure, so no `reason`. step.type is not 'setup' so the server
      // derives category 'user'.
      return {
        result: {
          success: false,
          error: {message: 'Run step dispatched before setup prepared the workspace'},
          exit_code: null,
        },
        logOutcome: 'drained',
        preparedWorkspace: false,
      };
    }

    // Agent steps run the embedded pi harness and forward every session entry into the log
    // pipeline as opaque `agent_session` records. Capture is best-effort: if the spool cannot
    // be opened, run the agent without it rather than failing the step.
    if (step.type === 'agent') {
      let runtimeConfig: Awaited<ReturnType<typeof requestAgentRuntimeConfig>>;
      try {
        runtimeConfig = await requestAgentRuntimeConfig(leaseClient, {
          stepId: step.id,
          attempt,
          signal,
        });
      } catch (error) {
        return {
          result: agentRuntimeConfigFailure(error),
          logOutcome: 'drained',
          preparedWorkspace: false,
        };
      }

      let sessionStream: SessionLogStream | undefined;
      const agentSecrets = [...secrets, ...Object.values(runtimeConfig.credentials)];
      try {
        sessionStream = createSessionLogStream({
          logsDir,
          stepId: step.id,
          attempt,
          secrets: agentSecrets,
          append,
        });
      } catch (error) {
        logger().error(
          {err: error, jobId, stepId: step.id, attempt},
          'Failed to open agent session capture; running the step without it',
        );
      }
      stream = sessionStream;
      const result = await executeAgentStep(step, {
        signal,
        cwd,
        credentials: runtimeConfig.credentials,
        ...(sessionStream
          ? {onSessionEntry: (line: string) => sessionStream?.writeEntry(line)}
          : {}),
      });
      return {
        result,
        stream,
        logOutcome: sessionStream ? undefined : 'abandoned',
        preparedWorkspace: false,
      };
    }

    // Log capture is best-effort: if the spool cannot be opened (e.g. a broken logs dir),
    // abandon capture and run the step without a stream rather than failing the step itself.
    let stepStream: StepLogStream | undefined;
    try {
      stepStream = createStepLogStream({
        logsDir,
        stepId: step.id,
        attempt,
        secrets,
        append,
      });
    } catch (error) {
      logger().error(
        {err: error, jobId, stepId: step.id, attempt},
        'Failed to open log capture; running the step without it',
      );
    }
    stream = stepStream;
    runStream = stepStream;

    const result = await executeRunStep(step, {
      signal,
      cwd,
      onCommandStart: (metadata) => writeCommandMetadata(stepStream, metadata),
      onOutput: (chunk, source) => stepStream?.write(chunk, source),
    });
    writeRunFailureContext(stepStream, result);
    return {
      result,
      stream,
      logOutcome: stepStream ? undefined : 'abandoned',
      preparedWorkspace: false,
    };
  } catch (error) {
    logger().error(
      {err: error, jobId, stepId: step.id},
      `Step ${stepLabel} crashed before producing a result`,
    );
    const result: StepResult = {
      success: false,
      error: {message: error instanceof Error ? error.message : String(error)},
      exit_code: null,
    };
    writeRunFailureContext(runStream, result);
    return {
      result,
      stream,
      logOutcome: stream ? undefined : step.type === 'setup' ? 'drained' : 'abandoned',
      preparedWorkspace: false,
    };
  }
}

function agentRuntimeConfigFailure(error: unknown): StepResult {
  if (error instanceof AgentRuntimeConfigRequestError) {
    return {
      success: false,
      error: {
        message: error.message,
        reason:
          error.code === 'agent-config-invalid'
            ? 'agent_config_invalid'
            : 'agent_invocation_failed',
      },
      exit_code: null,
    };
  }

  return {
    success: false,
    error: {message: error instanceof Error ? error.message : String(error)},
    exit_code: null,
  };
}

function writeCommandMetadata(
  stream: StepLogStream | undefined,
  metadata: CommandStartMetadata,
): void {
  stream?.writeGroup({
    name: `Run ${summarizeCommand(metadata.command)}`,
    lines: [
      metadata.command,
      `shell: ${metadata.shell.display}`,
      ...(metadata.cwd !== undefined ? [`working-directory: ${metadata.cwd}`] : []),
    ],
    source: 'stdout',
  });
}

function writeRunFailureContext(stream: StepLogStream | undefined, result: StepResult): void {
  if (result.success) return;
  stream?.writeOutputLine(runFailureContext(result), 'stderr');
}

function runFailureContext(result: StepResult): string {
  if (result.error?.signal) return `Process terminated by signal ${result.error.signal}.`;
  if (result.exit_code !== null) return `Process completed with exit code ${result.exit_code}.`;
  if (result.error?.message) return `Process failed: ${result.error.message}`;
  return 'Process failed.';
}

function summarizeCommand(command: string): string {
  const summary = command.trim().split(WHITESPACE_REGEX).join(' ');
  if (summary.length <= 120) return summary;
  return `${summary.slice(0, 117)}...`;
}

// Logs the outcome, seals the stream to learn its declared length, and reports the step.
// Returns whether the server asked the loop to stop (job finished without full success).
export async function reportStepResult(params: {
  leaseClient: KyInstance;
  step: StepDto;
  attempt: number;
  result: StepResult;
  logOutcome: LogOutcomeDto;
  jobId: string;
  stepLabel: string;
  signal: AbortSignal;
}): Promise<{cancel: boolean}> {
  const {leaseClient, step, attempt, result, logOutcome, jobId, stepLabel, signal} = params;

  if (result.success) {
    logger().info({jobId, stepId: step.id, stepName: step.name}, `Step ${stepLabel} succeeded`);
  } else {
    logger().error(
      {jobId, stepId: step.id, stepName: step.name, reason: result.error?.reason},
      `Step ${stepLabel} failed`,
    );
  }

  const report = await reportStep(leaseClient, {
    stepId: step.id,
    attempt,
    status: result.success ? 'succeeded' : 'failed',
    // null on success, the error shape on failure — matches reportStepBodySchema's refine.
    error: result.error,
    exitCode: result.exit_code,
    logOutcome,
    signal,
  });

  return {cancel: report.cancel};
}

// Closes (idempotent), drains (bounded; an abort cuts it short), and disposes a stream.
// A no-op when there is no stream, so callers can settle unconditionally.
export async function settleStream(params: {
  stream: LogStreamLifecycle | undefined;
  signal: AbortSignal;
}): Promise<LogDrainOutcome | undefined> {
  const {stream, signal} = params;
  if (!stream) return undefined;
  await stream.close();
  const outcome = await stream.drain({signal});
  stream.dispose();
  return outcome;
}
