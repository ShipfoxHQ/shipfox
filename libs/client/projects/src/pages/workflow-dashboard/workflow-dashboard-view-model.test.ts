import type {RunDetailResponseDto, RunDto} from '@shipfox/api-workflows-dto';
import {toWorkflowDashboardViewModel} from './workflow-dashboard-view-model.js';

const PROJECT_ID = '44444444-4444-4444-8444-444444444444';
const DEFINITION_ID = '55555555-5555-4555-8555-555555555555';
const RUN_ID = '66666666-6666-4666-8666-666666666666';
const JOB_ID = '77777777-7777-4777-8777-777777777777';
const STEP_ID = '88888888-8888-4888-8888-888888888888';
const ATTEMPT_ID = '99999999-9999-4999-8999-999999999999';

describe('toWorkflowDashboardViewModel', () => {
  test('maps run detail DTOs into the workflow dashboard view model', () => {
    const detail = runDetailDto();

    const viewModel = toWorkflowDashboardViewModel({detail, history: [historyRunDto()]});

    expect(viewModel.runOrder).toEqual([RUN_ID, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa']);
    expect(viewModel.workflow.yaml).toBe('name: Deploy production\n');
    expect(viewModel.runs[RUN_ID]?.duration).toBe(42);
    expect(viewModel.runs[RUN_ID]?.focus).toEqual({attempt: 1, job: 'deploy', step: 'ship'});
    expect(viewModel.runs[RUN_ID]?.trigger.incident).toBe('SENTRY-123');
    expect(viewModel.runs[RUN_ID]?.jobs[0]?.steps[0]?.command).toBe('./deploy.sh');
    expect(viewModel.runs[RUN_ID]?.jobs[0]?.steps[0]?.attempts[0]?.gateResult).toEqual({
      exitCode: 1,
      passed: false,
      source: 'quality_gate',
    });
    expect(viewModel.runs[RUN_ID]?.jobs[0]?.steps[0]?.attempts[0]?.output).toEqual({
      commit: 'abc123',
      deployed: false,
    });
  });

  test('keeps zero durations human-readable by preserving numeric seconds', () => {
    const detail = runDetailDto({
      duration_ms: 0,
      jobs: [],
      status: 'pending',
    });

    const viewModel = toWorkflowDashboardViewModel({detail, history: []});

    expect(viewModel.runs[RUN_ID]?.duration).toBe(0);
    expect(viewModel.runs[RUN_ID]?.jobs[0]?.duration).toBe(0);
    expect(viewModel.runs[RUN_ID]?.jobs[0]?.steps[0]?.duration).toBe(0);
  });

  test('preserves list order and creates placeholder rows for history-only runs', () => {
    const selected = runDetailDto();
    const older = historyRunDto({id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'});

    const viewModel = toWorkflowDashboardViewModel({detail: selected, history: [older, selected]});

    expect(viewModel.runOrder).toEqual(['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', RUN_ID]);
    expect(viewModel.runs['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb']?.jobs[0]?.steps[0]?.name).toBe(
      'pending',
    );
  });

  test('focuses the running step when the run has no failed step', () => {
    const detail = runDetailDto({
      status: 'running',
      jobs: [
        jobDto({
          status: 'running',
          steps: [
            stepDto({name: 'build', status: 'succeeded', position: 0}),
            stepDto({name: 'deploy', status: 'running', position: 1}),
          ],
        }),
      ],
    });

    const viewModel = toWorkflowDashboardViewModel({detail, history: []});

    expect(viewModel.runs[RUN_ID]?.focus).toEqual({attempt: 1, job: 'deploy', step: 'deploy'});
    expect(viewModel.runs[RUN_ID]?.jobs[0]?.steps[1]?.attempts[0]?.logs[1]?.message).toBe(
      'Step is still running.',
    );
  });
});

function runDetailDto(overrides: Partial<RunDetailResponseDto> = {}): RunDetailResponseDto {
  return {
    id: RUN_ID,
    project_id: PROJECT_ID,
    definition_id: DEFINITION_ID,
    name: 'Deploy production',
    status: 'failed',
    trigger_source: 'sentry',
    trigger_event: 'alert',
    trigger_payload: {incident: 'SENTRY-123', filter: 'production'},
    inputs: null,
    duration_ms: 42_000,
    workflow_source_yaml: 'name: Deploy production\n',
    workflow_document: null,
    workflow_model: null,
    jobs: [jobDto()],
    created_at: '2026-05-07T01:01:00.000Z',
    updated_at: '2026-05-07T01:02:00.000Z',
    ...overrides,
  };
}

function historyRunDto(overrides: Partial<RunDto> = {}): RunDto {
  return {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    project_id: PROJECT_ID,
    definition_id: DEFINITION_ID,
    name: 'Deploy production',
    status: 'succeeded',
    trigger_source: 'manual',
    trigger_event: 'fire',
    trigger_payload: {source: 'manual'},
    inputs: null,
    duration_ms: 10_000,
    created_at: '2026-05-06T01:01:00.000Z',
    updated_at: '2026-05-06T01:02:00.000Z',
    ...overrides,
  };
}

function jobDto(
  overrides: Partial<RunDetailResponseDto['jobs'][number]> = {},
): RunDetailResponseDto['jobs'][number] {
  return {
    id: JOB_ID,
    run_id: RUN_ID,
    name: 'deploy',
    status: 'failed',
    dependencies: [],
    position: 0,
    duration_ms: 42_000,
    created_at: '2026-05-07T01:01:00.000Z',
    updated_at: '2026-05-07T01:02:00.000Z',
    steps: [stepDto()],
    ...overrides,
  };
}

function stepDto(
  overrides: Partial<RunDetailResponseDto['jobs'][number]['steps'][number]> = {},
): RunDetailResponseDto['jobs'][number]['steps'][number] {
  return {
    id: STEP_ID,
    job_id: JOB_ID,
    name: 'ship',
    status: 'failed',
    type: 'command',
    config: {run: './deploy.sh'},
    error: null,
    position: 0,
    current_attempt: 1,
    duration_ms: 42_000,
    created_at: '2026-05-07T01:01:00.000Z',
    updated_at: '2026-05-07T01:02:00.000Z',
    attempts: [
      {
        id: ATTEMPT_ID,
        step_id: STEP_ID,
        job_id: JOB_ID,
        attempt: 1,
        status: overrides.status ?? 'failed',
        exit_code: overrides.status === 'running' ? null : 1,
        output: {commit: 'abc123', deployed: false, metadata: {region: 'us-east1'}},
        error: overrides.status === 'running' ? null : {message: 'Deployment failed'},
        gate_result:
          overrides.status === 'running'
            ? null
            : {passed: false, exit_code: 1, source: 'quality_gate'},
        restart_reason: null,
        duration_ms: 42_000,
        started_at: '2026-05-07T01:01:00.000Z',
        finished_at: overrides.status === 'running' ? null : '2026-05-07T01:02:00.000Z',
      },
    ],
    ...overrides,
  };
}
