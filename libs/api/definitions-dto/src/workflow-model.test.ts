import {
  createWorkflowModelSnapshot,
  flattenJobSteps,
  readPersistedWorkflowModel,
  type WorkflowModel,
  type WorkflowModelCompositeStep,
  type WorkflowModelStep,
} from './workflow-model.js';

function run(id: string): WorkflowModelStep {
  return {id, kind: 'run', command: {kind: 'shell', value: 'true'}};
}

function composite(id: string, steps: readonly WorkflowModelStep[]): WorkflowModelCompositeStep {
  return {
    id,
    kind: 'composite',
    composite: {
      uses: './.shipfox/actions/setup',
      origin: 'local',
      digest: `sha256:${'a'.repeat(64)}`,
      name: 'Setup',
      inputs: {},
      outputs: {},
      integrations: {},
    },
    steps,
  };
}

function model(steps: readonly WorkflowModelStep[]): WorkflowModel {
  return {
    kind: 'workflow',
    name: 'Build',
    triggers: [],
    jobs: [
      {
        id: 'build',
        key: 'build',
        mode: 'one_shot',
        runner: ['ubuntu-latest'],
        checkout: false,
        dependencies: [],
        steps,
      },
    ],
    dependencies: [],
  };
}

describe('flattenJobSteps', () => {
  test('lists each composite before its inner steps, nested composites inline', () => {
    const steps = [
      run('first'),
      composite('setup', [run('setup.a'), composite('setup.lint', [run('setup.lint.x')])]),
      run('last'),
    ];

    const flat = flattenJobSteps({steps});

    expect(flat.map((step) => step.id)).toEqual([
      'first',
      'setup',
      'setup.a',
      'setup.lint',
      'setup.lint.x',
      'last',
    ]);
  });
});

describe('createWorkflowModelSnapshot', () => {
  test('uses version 6 for a model with a composite step', () => {
    expect(createWorkflowModelSnapshot(model([composite('setup', [run('a')])])).version).toBe(6);
  });

  test('keeps a model without a composite step on its earlier version', () => {
    expect(createWorkflowModelSnapshot(model([run('a')])).version).toBe(3);
  });

  test('reads a version 6 snapshot', () => {
    const value = model([composite('setup', [run('a')])]);

    expect(readPersistedWorkflowModel({version: 6, model: value})).toEqual(value);
  });
});
