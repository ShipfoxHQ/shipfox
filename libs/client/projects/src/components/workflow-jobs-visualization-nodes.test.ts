import {
  type JobDto,
  jobDtoSchema,
  type StepAttemptDto,
  type StepDto,
  stepAttemptDtoSchema,
  stepDtoSchema,
} from '@shipfox/api-workflows-dto';
import {z} from 'zod';
import {toWorkflowJobNodes, type WorkflowJobDto} from './workflow-jobs-visualization.js';

const jobWithStepsSchema = jobDtoSchema.extend({
  steps: z.array(stepDtoSchema.extend({attempts: z.array(stepAttemptDtoSchema)})).optional(),
});

type WorkflowJobStep = StepDto & {attempts: StepAttemptDto[]};

function makeJob(overrides: Partial<JobDto> & {steps?: WorkflowJobDto['steps']}): WorkflowJobDto {
  const job = {
    id: '018fd019-2b2b-7cc3-98d4-0b4f91b7f001',
    run_id: '018fd019-2b2b-7cc3-98d4-0b4f91b7e000',
    name: 'build',
    status: 'succeeded',
    dependencies: [],
    position: 0,
    created_at: '2026-06-16T10:00:00.000Z',
    updated_at: '2026-06-16T10:01:00.000Z',
    ...overrides,
  };

  return jobWithStepsSchema.parse(job);
}

function makeStep(overrides: Partial<StepDto> & {attempts?: StepAttemptDto[]}): WorkflowJobStep {
  const step = {
    id: '018fd019-2b2b-7cc3-98d4-0b4f91b7f101',
    job_id: '018fd019-2b2b-7cc3-98d4-0b4f91b7f001',
    name: 'Install',
    source_location: null,
    status: 'succeeded',
    type: 'run',
    config: {run: 'pnpm install'},
    error: null,
    position: 0,
    current_attempt: 1,
    created_at: '2026-06-16T10:00:00.000Z',
    updated_at: '2026-06-16T10:01:00.000Z',
    attempts: [],
    ...overrides,
  };

  return stepDtoSchema.extend({attempts: z.array(stepAttemptDtoSchema)}).parse(step);
}

function makeAttempt(overrides: Partial<StepAttemptDto>): StepAttemptDto {
  const attempt = {
    id: '018fd019-2b2b-7cc3-98d4-0b4f91b7f201',
    step_id: '018fd019-2b2b-7cc3-98d4-0b4f91b7f101',
    job_id: '018fd019-2b2b-7cc3-98d4-0b4f91b7f001',
    attempt: 1,
    status: 'succeeded',
    exit_code: 0,
    output: null,
    error: null,
    gate_result: null,
    restart_reason: null,
    restart_result: null,
    started_at: '2026-06-16T10:00:00.000Z',
    finished_at: '2026-06-16T10:01:00.000Z',
    ...overrides,
  };

  return stepAttemptDtoSchema.parse(attempt);
}

describe('toWorkflowJobNodes', () => {
  test('sorts jobs by position and places a dependency chain into stages', () => {
    const build = makeJob({
      id: '018fd019-2b2b-7cc3-98d4-0b4f91b7f001',
      name: 'build',
      position: 0,
    });
    const test = makeJob({
      id: '018fd019-2b2b-7cc3-98d4-0b4f91b7f002',
      name: 'test',
      dependencies: [build.id],
      position: 1,
    });
    const deploy = makeJob({
      id: '018fd019-2b2b-7cc3-98d4-0b4f91b7f003',
      name: 'deploy',
      dependencies: [test.id],
      position: 2,
    });

    const nodes = toWorkflowJobNodes([deploy, test, build]);

    expect(nodes.map((node) => ({name: node.name, column: node.column}))).toEqual([
      {name: 'build', column: 0},
      {name: 'test', column: 1},
      {name: 'deploy', column: 2},
    ]);
  });

  test('places branch and join jobs by deepest dependency', () => {
    const build = makeJob({
      id: '018fd019-2b2b-7cc3-98d4-0b4f91b7f001',
      name: 'build',
      position: 0,
    });
    const lint = makeJob({
      id: '018fd019-2b2b-7cc3-98d4-0b4f91b7f002',
      name: 'lint',
      dependencies: [build.id],
      position: 1,
    });
    const unit = makeJob({
      id: '018fd019-2b2b-7cc3-98d4-0b4f91b7f003',
      name: 'unit',
      dependencies: [build.id],
      position: 2,
    });
    const deploy = makeJob({
      id: '018fd019-2b2b-7cc3-98d4-0b4f91b7f004',
      name: 'deploy',
      dependencies: [lint.id, unit.id],
      position: 3,
    });

    const nodes = toWorkflowJobNodes([deploy, unit, lint, build]);

    expect(nodes.map((node) => ({name: node.name, column: node.column}))).toEqual([
      {name: 'build', column: 0},
      {name: 'lint', column: 1},
      {name: 'unit', column: 1},
      {name: 'deploy', column: 2},
    ]);
    expect(nodes.find((node) => node.name === 'deploy')?.dependencyNames).toEqual(['lint', 'unit']);
  });

  test('keeps missing dependency ids visible and treats them as root inputs', () => {
    const deploy = makeJob({
      name: 'deploy',
      dependencies: ['missing-job-id'],
      position: 0,
    });

    const nodes = toWorkflowJobNodes([deploy]);

    expect(nodes[0]).toMatchObject({
      name: 'deploy',
      column: 0,
      dependencyNames: ['missing-job-id'],
    });
  });

  test('guards dependency cycles without recursing forever', () => {
    const build = makeJob({
      id: '018fd019-2b2b-7cc3-98d4-0b4f91b7f001',
      name: 'build',
      dependencies: ['018fd019-2b2b-7cc3-98d4-0b4f91b7f002'],
      position: 0,
    });
    const test = makeJob({
      id: '018fd019-2b2b-7cc3-98d4-0b4f91b7f002',
      name: 'test',
      dependencies: [build.id],
      position: 1,
    });

    const nodes = toWorkflowJobNodes([build, test]);

    expect(nodes.map((node) => node.column)).toEqual([2, 1]);
  });

  test('marks downstream jobs blocked by failed or cancelled dependencies', () => {
    const build = makeJob({
      id: '018fd019-2b2b-7cc3-98d4-0b4f91b7f001',
      name: 'build',
      status: 'failed',
      position: 0,
    });
    const deploy = makeJob({
      id: '018fd019-2b2b-7cc3-98d4-0b4f91b7f002',
      name: 'deploy',
      status: 'waiting_for_dependencies',
      dependencies: [build.id],
      position: 1,
    });

    const nodes = toWorkflowJobNodes([build, deploy]);

    expect(nodes.find((node) => node.name === 'deploy')).toMatchObject({
      statusLabel: 'Blocked',
      statusVariant: 'error',
      blockedBy: ['build'],
    });
  });

  test('derives typed attempt count from step attempts', () => {
    const attempts = [
      makeAttempt({attempt: 1, status: 'failed', exit_code: 1}),
      makeAttempt({
        id: '018fd019-2b2b-7cc3-98d4-0b4f91b7f202',
        attempt: 3,
        status: 'succeeded',
        exit_code: 0,
      }),
    ];
    const deploy = makeJob({
      name: 'deploy',
      steps: [makeStep({current_attempt: 2, attempts})],
    });

    const nodes = toWorkflowJobNodes([deploy]);

    expect(nodes[0]?.attemptCount).toBe(3);
  });
});
