import {type JobDto, jobDtoSchema} from '@shipfox/api-workflows-dto';
import {toWorkflowJobNodes, type WorkflowJobDto} from './workflow-jobs-visualization.js';

function makeJob(overrides: Partial<JobDto>): WorkflowJobDto {
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

  return jobDtoSchema.parse(job);
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

  test('orders nodes by job position regardless of input order', () => {
    const first = makeJob({
      id: '018fd019-2b2b-7cc3-98d4-0b4f91b7f001',
      name: 'first',
      position: 0,
    });
    const second = makeJob({
      id: '018fd019-2b2b-7cc3-98d4-0b4f91b7f002',
      name: 'second',
      position: 1,
    });
    const third = makeJob({
      id: '018fd019-2b2b-7cc3-98d4-0b4f91b7f003',
      name: 'third',
      position: 2,
    });

    const nodes = toWorkflowJobNodes([third, first, second]);

    expect(nodes.map((node) => node.name)).toEqual(['first', 'second', 'third']);
  });

  test('maps a healthy single job to neutral-or-status visuals without blocking', () => {
    const build = makeJob({name: 'build', status: 'running'});

    const nodes = toWorkflowJobNodes([build]);

    expect(nodes[0]).toMatchObject({
      name: 'build',
      status: 'running',
      statusLabel: 'Running',
      statusVariant: 'info',
      statusDotVariant: 'info',
      blockedBy: [],
      dependencyNames: [],
    });
  });
});
