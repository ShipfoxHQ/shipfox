import type {RunJobDetailDto} from '@shipfox/api-workflows-dto';
import type {WorkflowJob, WorkflowRunDetail} from '#core/workflow-run.js';
import {workflowJob, workflowRunDetail} from '#test/fixtures/workflow-run.js';
import {buildWorkflowJobGraphModel, nextWorkflowJobGraphNodeId} from './graph-model.js';

describe('buildWorkflowJobGraphModel', () => {
  test('returns an empty model with a real trigger node', () => {
    const run = makeRun({jobs: []});

    const result = buildWorkflowJobGraphModel({run});

    expect(result.trigger.triggerLabel).toBe('github / push');
    expect(result.nodes).toEqual([]);
    expect(result.edges).toEqual([]);
    expect(result.columns).toEqual([]);
  });

  test('maps a single job with a trigger edge', () => {
    const run = makeRun({jobs: [makeJob({name: 'build'})]});

    const result = buildWorkflowJobGraphModel({run});

    expect(result.nodes).toMatchObject([{name: 'build', column: 0, row: 0}]);
    expect(result.edges).toMatchObject([
      {from: 'trigger', to: result.nodes[0]?.id, kind: 'trigger'},
    ]);
  });

  test('resolves dependencies by job name', () => {
    const build = makeJob({name: 'build', position: 0});
    const deploy = makeJob({name: 'deploy', position: 1, dependencies: ['build']});
    const run = makeRun({jobs: [deploy, build]});

    const result = buildWorkflowJobGraphModel({run});

    expect(nodeByName(result, 'build')).toMatchObject({column: 0});
    expect(nodeByName(result, 'deploy')).toMatchObject({column: 1, dependencies: ['build']});
    expect(result.edges).toContainEqual(
      expect.objectContaining({from: build.id, to: deploy.id, kind: 'dependency'}),
    );
  });

  test('emits one trigger edge for each root job in parallel fan-out', () => {
    const jobs = Array.from({length: 10}, (_, index) =>
      makeJob({name: `job-${String(index + 1).padStart(2, '0')}`, position: index}),
    );
    const run = makeRun({jobs});

    const result = buildWorkflowJobGraphModel({run});

    expect(result.columns).toHaveLength(1);
    expect(result.columns[0]).toHaveLength(10);
    expect(result.edges.filter((edge) => edge.kind === 'trigger')).toHaveLength(10);
  });

  test('orders parallel jobs by position inside a column', () => {
    const run = makeRun({
      jobs: [
        makeJob({name: 'zeta', position: 2}),
        makeJob({name: 'alpha', position: 1}),
        makeJob({name: 'middle', position: 3}),
      ],
    });

    const result = buildWorkflowJobGraphModel({run});

    expect(result.columns[0]?.map((node) => node.name)).toEqual(['alpha', 'zeta', 'middle']);
  });

  test('lays out a ten-job sequence across ten columns', () => {
    const jobs = Array.from({length: 10}, (_, index) =>
      makeJob({
        name: `job-${String(index + 1).padStart(2, '0')}`,
        position: index,
        dependencies: index === 0 ? [] : [`job-${String(index).padStart(2, '0')}`],
      }),
    );
    const run = makeRun({jobs});

    const result = buildWorkflowJobGraphModel({run});

    expect(result.columns).toHaveLength(10);
    expect(nodeByName(result, 'job-10')).toMatchObject({column: 9});
  });

  test('places branch siblings in the same column and a join after them', () => {
    const build = makeJob({name: 'build', position: 0});
    const lint = makeJob({name: 'lint', position: 1, dependencies: ['build']});
    const testJob = makeJob({name: 'test', position: 2, dependencies: ['build']});
    const deploy = makeJob({name: 'deploy', position: 3, dependencies: ['lint', 'test']});
    const run = makeRun({jobs: [deploy, testJob, lint, build]});

    const result = buildWorkflowJobGraphModel({run});

    expect(nodeByName(result, 'lint')).toMatchObject({column: 1});
    expect(nodeByName(result, 'test')).toMatchObject({column: 1});
    expect(nodeByName(result, 'deploy')).toMatchObject({column: 2});
    expect(nodeByName(result, 'deploy')?.dependencies).toEqual(['lint', 'test']);
  });

  test('moves keyboard navigation across columns and rows', () => {
    const build = makeJob({name: 'build', position: 0});
    const lint = makeJob({name: 'lint', position: 1, dependencies: ['build']});
    const testJob = makeJob({name: 'test', position: 2, dependencies: ['build']});
    const deploy = makeJob({name: 'deploy', position: 3, dependencies: ['lint', 'test']});
    const run = makeRun({jobs: [build, lint, testJob, deploy]});
    const model = buildWorkflowJobGraphModel({run});

    const nextFromBuild = nextWorkflowJobGraphNodeId({
      model,
      currentNodeId: build.id,
      key: 'ArrowRight',
    });
    const downFromLint = nextWorkflowJobGraphNodeId({
      model,
      currentNodeId: lint.id,
      key: 'ArrowDown',
    });
    const rightFromTest = nextWorkflowJobGraphNodeId({
      model,
      currentNodeId: testJob.id,
      key: 'ArrowRight',
    });

    expect(nextFromBuild).toBe(lint.id);
    expect(downFromLint).toBe(testJob.id);
    expect(rightFromTest).toBe(deploy.id);
  });

  test('keeps downstream cancellation as the persisted status', () => {
    const build = makeJob({name: 'build', status: 'failed'});
    const deploy = makeJob({
      name: 'deploy',
      status: 'cancelled',
      position: 1,
      dependencies: ['build'],
    });
    const run = makeRun({jobs: [build, deploy]});

    const result = buildWorkflowJobGraphModel({run});

    expect(nodeByName(result, 'deploy')).toMatchObject({
      status: 'cancelled',
    });
  });
});

function nodeByName(result: ReturnType<typeof buildWorkflowJobGraphModel>, name: string) {
  return result.nodes.find((node) => node.name === name);
}

function makeRun(overrides: Partial<WorkflowRunDetail> = {}): WorkflowRunDetail {
  return {
    ...workflowRunDetail({
      name: 'Deploy',
      trigger_source: 'github',
      trigger_event: 'push',
      started_at: '2026-06-21T12:00:10.000Z',
      jobs: [],
    }),
    ...overrides,
  };
}

function makeJob(overrides: Partial<RunJobDetailDto> & {name: string}): WorkflowJob {
  return workflowJob(overrides);
}
