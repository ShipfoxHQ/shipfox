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

  test('uses version 7 for a model with a continue_on_error step', () => {
    const step = {...run('a'), continueOnError: true as const};

    expect(createWorkflowModelSnapshot(model([step])).version).toBe(7);
  });

  test('uses version 7 for continue_on_error inside a composite', () => {
    const inner = {...run('setup.a'), continueOnError: true as const};

    expect(createWorkflowModelSnapshot(model([composite('setup', [inner])])).version).toBe(7);
  });

  test('reads a version 7 snapshot', () => {
    const value = model([{...run('a'), continueOnError: true}]);

    expect(readPersistedWorkflowModel({version: 7, model: value})).toEqual(value);
  });

  test('uses version 8 for a model with a background step', () => {
    const step = {...run('a'), key: 'a', background: true as const, joinedAt: 2};
    const wait: WorkflowModelStep = {id: 'wait', kind: 'wait', targets: ['a'], origin: 'authored'};

    expect(createWorkflowModelSnapshot(model([step, wait])).version).toBe(8);
  });

  test('uses version 8 for a cancel step', () => {
    const cancel: WorkflowModelStep = {id: 'cancel', kind: 'cancel', targets: ['a']};

    expect(createWorkflowModelSnapshot(model([cancel])).version).toBe(8);
  });

  test('uses version 8 for a background step inside a composite', () => {
    const inner = {...run('setup.a'), background: true as const};

    expect(createWorkflowModelSnapshot(model([composite('setup', [inner])])).version).toBe(8);
  });

  test('prefers version 8 over version 7 when both features are used', () => {
    const step = {...run('a'), continueOnError: true as const, background: true as const};

    expect(createWorkflowModelSnapshot(model([step])).version).toBe(8);
  });

  test('reads a version 8 snapshot', () => {
    const value = model([{...run('a'), background: true}]);

    expect(readPersistedWorkflowModel({version: 8, model: value})).toEqual(value);
  });
});
