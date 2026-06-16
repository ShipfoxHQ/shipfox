import type {RunDetailResponseDto, RunDto} from '@shipfox/api-workflows-dto';
import type {
  WorkflowDashboardAttempt,
  WorkflowDashboardGateResult,
  WorkflowDashboardJob,
  WorkflowDashboardLogLine,
  WorkflowDashboardRun,
  WorkflowDashboardStatus,
  WorkflowDashboardStep,
  WorkflowDashboardViewModel,
} from './workflow-dashboard-types.js';

type DetailJob = RunDetailResponseDto['jobs'][number];
type DetailStep = DetailJob['steps'][number];
type DetailAttempt = DetailStep['attempts'][number];

const fallbackYaml =
  'name: Workflow\njobs:\n  workflow:\n    steps:\n      - run: echo "Waiting for execution data"';

export function toWorkflowDashboardViewModel({
  detail,
  history,
}: {
  detail: RunDetailResponseDto;
  history: RunDto[];
}): WorkflowDashboardViewModel {
  const runs: Record<string, WorkflowDashboardRun> = {};
  const historyRuns = uniqueRuns(history);
  const orderedHistory = historyRuns.some((run) => run.id === detail.id)
    ? historyRuns
    : [detail, ...historyRuns];

  for (const run of orderedHistory) {
    runs[run.id] = run.id === detail.id ? detailRun(detail) : historyRun(run);
  }

  return {
    runOrder: orderedHistory.map((run) => run.id),
    runs,
    workflow: {
      sourcePath: '.shipfox/workflows/workflow.yml',
      yaml: detail.workflow_source_yaml ?? fallbackYaml,
    },
  };
}

function uniqueRuns(runs: RunDto[]): RunDto[] {
  const seen = new Set<string>();
  return runs.filter((run) => {
    if (seen.has(run.id)) return false;
    seen.add(run.id);
    return true;
  });
}

function detailRun(run: RunDetailResponseDto): WorkflowDashboardRun {
  const jobs = run.jobs
    .slice()
    .sort((a, b) => a.position - b.position)
    .map(toDashboardJob);
  const nonEmptyJobs = jobs.length > 0 ? jobs : [placeholderJob(run)];
  const focus = focusFor(nonEmptyJobs);

  return {
    duration: seconds(run.duration_ms),
    focus,
    jobs: nonEmptyJobs,
    number: run.id.slice(0, 8),
    observedUntil: run.updated_at,
    status: toDashboardStatus(run.status),
    trigger: triggerFor(run),
  };
}

function historyRun(run: RunDto): WorkflowDashboardRun {
  return {
    duration: seconds(run.duration_ms),
    focus: {attempt: 1, job: 'workflow', step: 'pending'},
    jobs: [placeholderJob(run)],
    number: run.id.slice(0, 8),
    observedUntil: run.updated_at,
    status: toDashboardStatus(run.status),
    trigger: triggerFor(run),
  };
}

function toDashboardJob(job: DetailJob): WorkflowDashboardJob {
  const steps = job.steps
    .slice()
    .sort((a, b) => a.position - b.position)
    .map(toDashboardStep);
  const needs = job.dependencies.length > 0 ? job.dependencies.join(', ') : undefined;

  return {
    duration: seconds(job.duration_ms),
    name: job.name,
    ...(needs ? {needs} : {}),
    status: toDashboardStatus(job.status),
    steps: steps.length > 0 ? steps : [placeholderStep(job.name, job.status, job.updated_at)],
  };
}

function toDashboardStep(step: DetailStep): WorkflowDashboardStep {
  const attempts = step.attempts
    .slice()
    .sort((a, b) => a.attempt - b.attempt)
    .map((attempt) => toDashboardAttempt(attempt, step));
  const hasGate = attempts.some((attempt) => attempt.gateResult);
  const notRunLog: WorkflowDashboardLogLine[] | undefined =
    attempts.length === 0
      ? [
          {
            at: step.updated_at,
            message: step.status === 'pending' ? 'Step has not started yet.' : 'Step did not run.',
            stream: 'system',
          },
        ]
      : undefined;

  return {
    attemptCount: step.current_attempt,
    attempts,
    command: commandFor(step),
    duration: seconds(step.duration_ms),
    gate: hasGate,
    kind: kindFor(step.type),
    name: step.name ?? `step-${step.position + 1}`,
    ...(notRunLog ? {notRunLog} : {}),
    status: toDashboardStatus(step.status),
  };
}

function toDashboardAttempt(attempt: DetailAttempt, step: DetailStep): WorkflowDashboardAttempt {
  const status = toDashboardStatus(attempt.status);
  const gate = gateResult(attempt.gate_result);
  const output = outputFor(attempt.output);

  return {
    duration: seconds(attempt.duration_ms),
    exitCode: attempt.exit_code,
    ...(gate ? {gateResult: gate} : {}),
    logs: logsFor(attempt, step),
    number: attempt.attempt,
    ...(output ? {output} : {}),
    startedAt: attempt.started_at,
    status,
  };
}

function placeholderJob(
  run: Pick<RunDto, 'duration_ms' | 'name' | 'status' | 'updated_at'>,
): WorkflowDashboardJob {
  return {
    duration: seconds(run.duration_ms),
    name: run.name || 'workflow',
    status: toDashboardStatus(run.status),
    steps: [placeholderStep('pending', run.status, run.updated_at)],
  };
}

function placeholderStep(name: string, status: string, at: string): WorkflowDashboardStep {
  return {
    attemptCount: 0,
    attempts: [],
    command: 'waiting for execution data',
    duration: 0,
    kind: 'command',
    name,
    notRunLog: [{at, message: 'Execution details are not available yet.', stream: 'system'}],
    status: toDashboardStatus(status),
  };
}

function triggerFor(
  run: Pick<RunDto, 'created_at' | 'trigger_event' | 'trigger_payload' | 'trigger_source'>,
) {
  return {
    alertAt: run.created_at,
    event: run.trigger_event,
    filter: triggerValue(run.trigger_payload, 'filter') ?? run.trigger_event,
    incident:
      triggerValue(run.trigger_payload, 'incident') ??
      triggerValue(run.trigger_payload, 'issue') ??
      triggerValue(run.trigger_payload, 'deliveryId') ??
      run.trigger_event,
    payload: run.trigger_payload,
    runStartedAt: run.created_at,
    source: run.trigger_source,
  };
}

function focusFor(jobs: WorkflowDashboardJob[]) {
  const focusedJob =
    jobs.find((job) => job.status === 'failed') ??
    jobs.find((job) => job.status === 'running') ??
    jobs[0];
  const focusedStep =
    focusedJob?.steps.find((step) => step.status === 'failed') ??
    focusedJob?.steps.find((step) => step.status === 'running') ??
    focusedJob?.steps[0];

  return {
    attempt: focusedStep?.attempts.at(-1)?.number ?? 1,
    job: focusedJob?.name ?? 'workflow',
    step: focusedStep?.name ?? 'pending',
  };
}

function commandFor(step: DetailStep): string {
  const command = stringValue(step.config, 'command') ?? stringValue(step.config, 'run');
  if (command) return command;
  if (step.type) return step.type;
  return 'run step';
}

function kindFor(type: string): WorkflowDashboardStep['kind'] {
  if (type === 'agent') return 'agent';
  if (type === 'deploy') return 'deploy';
  if (type === 'integration') return 'integration';
  if (type === 'notify') return 'notify';
  return 'command';
}

function logsFor(attempt: DetailAttempt, step: DetailStep): WorkflowDashboardLogLine[] {
  const lines: WorkflowDashboardLogLine[] = [
    {
      at: attempt.started_at,
      message: `$ ${commandFor(step)}`,
      stream: 'system',
    },
  ];

  if (attempt.error) {
    lines.push({
      at: attempt.finished_at ?? attempt.started_at,
      diagnostic: true,
      message: errorMessage(attempt.error),
      stream: 'stderr',
    });
  } else if (attempt.status === 'running') {
    lines.push({
      at: attempt.started_at,
      message: 'Step is still running.',
      stream: 'stdout',
    });
  } else {
    lines.push({
      at: attempt.finished_at ?? attempt.started_at,
      message: `Step ${attempt.status}.`,
      stream: attempt.status === 'failed' ? 'stderr' : 'stdout',
    });
  }

  return lines;
}

function gateResult(
  value: Record<string, unknown> | null,
): WorkflowDashboardGateResult | undefined {
  if (!value) return undefined;
  const passed = booleanValue(value, 'passed');
  return {
    exitCode: numberValue(value, 'exit_code') ?? numberValue(value, 'exitCode') ?? 0,
    passed: passed ?? false,
    source: stringValue(value, 'source') ?? 'gate',
  };
}

function outputFor(value: Record<string, unknown> | null) {
  if (!value) return undefined;
  const output = Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, boolean | number | string] =>
      ['boolean', 'number', 'string'].includes(typeof entry[1]),
    ),
  );
  return Object.keys(output).length > 0 ? output : undefined;
}

function errorMessage(value: Record<string, unknown>): string {
  return stringValue(value, 'message') ?? JSON.stringify(value);
}

function toDashboardStatus(status: string): WorkflowDashboardStatus {
  if (
    status === 'pending' ||
    status === 'running' ||
    status === 'succeeded' ||
    status === 'failed' ||
    status === 'cancelled'
  ) {
    return status;
  }
  return 'pending';
}

function seconds(ms: number): number {
  return Math.floor(Math.max(0, ms) / 1000);
}

function triggerValue(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key];
  return typeof value === 'string' && value ? value : undefined;
}

function stringValue(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key];
  return typeof value === 'string' && value ? value : undefined;
}

function numberValue(payload: Record<string, unknown>, key: string): number | undefined {
  const value = payload[key];
  return typeof value === 'number' ? value : undefined;
}

function booleanValue(payload: Record<string, unknown>, key: string): boolean | undefined {
  const value = payload[key];
  return typeof value === 'boolean' ? value : undefined;
}
