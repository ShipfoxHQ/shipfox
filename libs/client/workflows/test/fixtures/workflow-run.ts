import type {
  JobStatusDto,
  RunAttemptDto,
  RunAttemptsResponseDto,
  RunDetailResponseDto,
  RunJobDetailDto,
  RunListResponseDto,
  RunResponseDto,
  RunStatusDto,
  RunStepDetailDto,
  StepAttemptDto,
} from '@shipfox/api-workflows-dto';
import {
  toWorkflowJob,
  toWorkflowRun,
  toWorkflowRunDetail,
  toWorkflowRunListPage,
  toWorkflowStep,
  toWorkflowStepAttempt,
  type WorkflowJob,
  type WorkflowRun,
  type WorkflowRunDetail,
  type WorkflowRunListPage,
  type WorkflowStep,
  type WorkflowStepAttempt,
} from '#core/workflow-run.js';

const RUN_ID = '11111111-1111-4111-8111-111111111111';
const PROJECT_ID = '22222222-2222-4222-8222-222222222222';
const DEFINITION_ID = '33333333-3333-4333-8333-333333333333';
const JOB_ID = '44444444-4444-4444-8444-000000000001';
const STEP_ID = '55555555-5555-4555-8555-000000000001';

let runSequence = 0;
let jobSequence = 0;
let stepSequence = 0;
let attemptSequence = 0;

export function workflowRunDto(overrides: Partial<RunResponseDto> = {}): RunResponseDto {
  return {
    id: RUN_ID,
    project_id: PROJECT_ID,
    definition_id: DEFINITION_ID,
    name: 'deploy-web',
    status: 'running',
    source_run_id: null,
    root_run_id: null,
    attempt: 1,
    rerun_mode: null,
    trigger_source: 'manual',
    trigger_event: 'fire',
    trigger_payload: {},
    inputs: null,
    source_snapshot: null,
    created_at: '2026-06-21T12:00:00.000Z',
    updated_at: '2026-06-21T12:01:00.000Z',
    started_at: null,
    finished_at: null,
    ...overrides,
  };
}

export function workflowRun(overrides: Partial<RunResponseDto> = {}): WorkflowRun {
  return toWorkflowRun(workflowRunDto(overrides));
}

export function workflowRunListResponseDto(
  overrides: Partial<RunListResponseDto> = {},
): RunListResponseDto {
  return {
    runs: [workflowRunDto()],
    next_cursor: null,
    filtered_total_count: 1,
    ...overrides,
  };
}

export function workflowRunListPage(
  overrides: Partial<RunListResponseDto> = {},
): WorkflowRunListPage {
  return toWorkflowRunListPage(workflowRunListResponseDto(overrides));
}

export function workflowRunDetailDto(
  overrides: Partial<RunDetailResponseDto> = {},
): RunDetailResponseDto {
  return {
    ...workflowRunDto(),
    latest_attempt: 1,
    jobs: [],
    ...overrides,
  };
}

export function workflowRunDetail(
  overrides: Partial<RunDetailResponseDto> = {},
): WorkflowRunDetail {
  return toWorkflowRunDetail(workflowRunDetailDto(overrides));
}

export function workflowRunAttemptDto(overrides: Partial<RunAttemptDto> = {}): RunAttemptDto {
  return {
    id: RUN_ID,
    attempt: 1,
    status: 'running',
    created_at: '2026-06-21T12:00:00.000Z',
    rerun_mode: null,
    ...overrides,
  };
}

export function runAttemptsResponseDto(
  overrides: Partial<RunAttemptsResponseDto> = {},
): RunAttemptsResponseDto {
  return {
    attempts: [workflowRunAttemptDto()],
    ...overrides,
  };
}

export function workflowJobDto(overrides: Partial<RunJobDetailDto> = {}): RunJobDetailDto {
  jobSequence += 1;
  const job: RunJobDetailDto = {
    id: `44444444-4444-4444-8444-${String(jobSequence).padStart(12, '0')}`,
    run_id: RUN_ID,
    name: 'build',
    status: 'pending',
    status_reason: null,
    carried_over: false,
    dependencies: [],
    position: 0,
    created_at: '2026-06-21T12:00:00.000Z',
    updated_at: '2026-06-21T12:01:00.000Z',
    queued_at: null,
    started_at: null,
    finished_at: null,
    duration: {kind: 'none'},
    steps: [],
    ...overrides,
  };

  return {
    ...job,
    duration: overrides.duration ?? workflowJobDurationDto(job),
  };
}

export function workflowJob(overrides: Partial<RunJobDetailDto> = {}): WorkflowJob {
  return toWorkflowJob(workflowJobDto(overrides));
}

export function workflowStepDto(overrides: Partial<RunStepDetailDto> = {}): RunStepDetailDto {
  stepSequence += 1;
  const displayName =
    overrides.display_name ??
    (typeof overrides.name === 'string' && overrides.name.trim() ? overrides.name : 'build');

  return {
    id: `55555555-5555-4555-8555-${String(stepSequence).padStart(12, '0')}`,
    job_id: JOB_ID,
    name: 'build',
    display_name: displayName,
    source_location: null,
    status: 'pending',
    type: 'run',
    config: {},
    error: null,
    position: 0,
    current_attempt: 1,
    created_at: '2026-06-21T12:00:00.000Z',
    updated_at: '2026-06-21T12:01:00.000Z',
    attempts: [],
    ...overrides,
  };
}

export function workflowStep(overrides: Partial<RunStepDetailDto> = {}): WorkflowStep {
  return toWorkflowStep(workflowStepDto(overrides));
}

export function workflowStepAttemptDto(overrides: Partial<StepAttemptDto> = {}): StepAttemptDto {
  attemptSequence += 1;
  return {
    id: `66666666-6666-4666-8666-${String(attemptSequence).padStart(12, '0')}`,
    step_id: STEP_ID,
    job_id: JOB_ID,
    attempt: 1,
    execution_order: attemptSequence,
    status: 'pending',
    exit_code: null,
    output: null,
    error: null,
    gate_result: null,
    restart_reason: null,
    restart_result: null,
    started_at: '2026-06-21T12:00:00.000Z',
    finished_at: null,
    ...overrides,
  };
}

export function workflowStepAttempt(overrides: Partial<StepAttemptDto> = {}): WorkflowStepAttempt {
  return toWorkflowStepAttempt(workflowStepAttemptDto(overrides));
}

function workflowJobDurationDto(
  job: Pick<RunJobDetailDto, 'status' | 'queued_at' | 'started_at' | 'finished_at'>,
): RunJobDetailDto['duration'] {
  const terminal = TERMINAL_JOB_STATUSES.has(job.status);

  if (job.started_at === null) {
    if (terminal || job.queued_at === null) return {kind: 'none'};
    return {kind: 'queued', from_iso: job.queued_at};
  }

  if (job.finished_at !== null) {
    return {kind: 'finished', from_iso: job.started_at, to_iso: job.finished_at};
  }

  if (terminal) {
    return {kind: 'none'};
  }

  return {kind: 'running', from_iso: job.started_at};
}

const TERMINAL_JOB_STATUSES = new Set<JobStatusDto>([
  'succeeded',
  'failed',
  'cancelled',
  'skipped',
]);

export function sequencedWorkflowRunDto(
  status: RunStatusDto,
  name: string,
  minutesAgo: number,
  overrides: Partial<RunResponseDto> = {},
): RunResponseDto {
  runSequence += 1;
  return workflowRunDto({
    id: `run-${String(runSequence).padStart(8, '0')}`,
    project_id: 'proj-demo',
    definition_id: 'def-demo',
    name,
    status,
    trigger_source: status === 'pending' ? '' : 'github',
    trigger_event: status === 'pending' ? '' : 'push',
    created_at: new Date(Date.now() - minutesAgo * 120_000).toISOString(),
    updated_at: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
    ...overrides,
  });
}

export function sequencedWorkflowRun(
  status: RunStatusDto,
  name: string,
  minutesAgo: number,
  overrides: Partial<RunResponseDto> = {},
): WorkflowRun {
  return toWorkflowRun(sequencedWorkflowRunDto(status, name, minutesAgo, overrides));
}

export function workflowJobWithName(
  name: string,
  overrides: Partial<RunJobDetailDto> = {},
): RunJobDetailDto {
  return workflowJobDto({name, ...overrides});
}

export type {JobStatusDto, RunStatusDto};
