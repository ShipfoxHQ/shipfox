import {createWorkflowModelSnapshot} from '@shipfox/api-definitions-dto';
import {parseWorkflowDocument} from '@shipfox/workflow-document';
import {agentValidationCatalog} from '#test/agent-validation-catalog.js';
import type {WorkflowModel, WorkflowModelStep} from '../entities/workflow-model.js';
import {parseWorkflowYamlWithLocations} from '../workflow-yaml/parse-workflow-yaml.js';
import {InvalidWorkflowModelError} from './invalid-workflow-model-error.js';
import {normalizeWorkflowDocument} from './normalize-workflow-document.js';

type Step = Record<string, unknown>;

function interpolation(source: string): string {
  return '$'.concat('{{ ', source, ' }}');
}

function documentWith(steps: Step[], job: Record<string, unknown> = {}) {
  return parseWorkflowDocument(
    {name: 'concurrent', runner: 'ubuntu-latest', jobs: {build: {...job, steps}}},
    {concurrentSteps: true},
  );
}

function normalize(steps: Step[], job: Record<string, unknown> = {}): WorkflowModel {
  return normalizeWorkflowDocument(documentWith(steps, job), {agentValidationCatalog});
}

function issuesOf(steps: Step[], job: Record<string, unknown> = {}) {
  try {
    normalize(steps, job);
  } catch (error) {
    if (error instanceof InvalidWorkflowModelError) {
      return error.issues.map((issue) => ({
        code: issue.code,
        path: issue.path.join('.'),
        message: issue.message,
      }));
    }
    throw error;
  }
  return [];
}

function expectInvalid(
  steps: Step[],
  job: Record<string, unknown> = {},
): InvalidWorkflowModelError {
  try {
    normalize(steps, job);
  } catch (error) {
    if (error instanceof InvalidWorkflowModelError) return error;
    throw error;
  }
  return expect.fail('Expected InvalidWorkflowModelError');
}

function stepsOf(model: WorkflowModel): readonly WorkflowModelStep[] {
  return model.jobs[0]?.steps ?? [];
}

function summary(step: WorkflowModelStep) {
  return {
    id: step.id,
    kind: step.kind,
    ...(step.background === true ? {background: true} : {}),
    ...(step.parallelGroup === undefined ? {} : {parallelGroup: step.parallelGroup}),
    ...(step.joinedAt === undefined ? {} : {joinedAt: step.joinedAt}),
    ...(step.kind === 'wait' || step.kind === 'cancel' ? {targets: step.targets} : {}),
    ...(step.kind === 'wait' ? {origin: step.origin} : {}),
  };
}

describe('expanding a parallel block', () => {
  it('turns keyless members into background steps followed by a wait that names them', () => {
    const model = normalize([
      {run: 'npm ci'},
      {parallel: [{run: 'lint'}, {run: 'typecheck'}]},
      {run: 'npm test'},
    ]);

    expect(stepsOf(model).map(summary)).toEqual([
      {id: 'build-step-1', kind: 'run'},
      {
        id: 'build-step-2',
        kind: 'run',
        background: true,
        parallelGroup: 'parallel-2',
        joinedAt: 4,
      },
      {
        id: 'build-step-3',
        kind: 'run',
        background: true,
        parallelGroup: 'parallel-2',
        joinedAt: 4,
      },
      {
        id: 'build-step-4',
        kind: 'wait',
        parallelGroup: 'parallel-2',
        targets: ['build-step-2', 'build-step-3'],
        origin: 'parallel',
      },
      {id: 'build-step-5', kind: 'run'},
    ]);
  });

  it('names members with a key by their key', () => {
    const model = normalize([
      {
        parallel: [
          {key: 'security', prompt: 'Review security.'},
          {key: 'perf', prompt: 'Review perf.'},
        ],
      },
    ]);

    const wait = stepsOf(model).find((step) => step.kind === 'wait');
    expect(wait).toMatchObject({targets: ['build-security', 'build-perf'], origin: 'parallel'});
  });

  it('runs the wait whatever happened before it', () => {
    const wait = stepsOf(normalize([{parallel: [{run: 'a'}, {run: 'b'}]}])).find(
      (step) => step.kind === 'wait',
    );

    expect(wait).toMatchObject({runAfter: 'always'});
    expect(wait).not.toHaveProperty('if');
  });

  it('does not wait for background steps that were already running', () => {
    const model = normalize([
      {key: 'db', background: true, run: 'docker run postgres'},
      {parallel: [{run: 'a'}, {run: 'b'}]},
      {cancel: 'db'},
    ]);

    const waits = stepsOf(model).filter((step) => step.kind === 'wait');
    expect(waits.map(summary)).toEqual([
      {
        id: 'build-step-4',
        kind: 'wait',
        parallelGroup: 'parallel-2',
        targets: ['build-step-2', 'build-step-3'],
        origin: 'parallel',
      },
    ]);
  });

  it('carries a source location for the members and the wait', () => {
    const yaml = [
      'name: concurrent',
      'runner: ubuntu-latest',
      'jobs:',
      '  build:',
      '    steps:',
      '      - run: first',
      '      - parallel:',
      '          - run: left',
      '          - run: right',
      '      - run: last',
    ].join('\n');
    const {document, stepSourceLocations} = parseWorkflowYamlWithLocations(yaml, {
      concurrentSteps: true,
    });

    const model = normalizeWorkflowDocument(document, {
      agentValidationCatalog,
      stepSourceLocations,
    });

    expect(stepsOf(model).map((step) => step.sourceLocation?.startLine)).toEqual([6, 8, 9, 7, 10]);
  });
});

describe('resolving wait and cancel', () => {
  it('resolves a wait by key to step ids', () => {
    const model = normalize([
      {key: 'db', background: true, run: 'docker run postgres'},
      {key: 'seed', background: true, run: 'seed'},
      {wait: ['seed', 'db'], name: 'Wait for setup'},
    ]);

    const wait = stepsOf(model).at(-1);
    expect(wait).toMatchObject({
      kind: 'wait',
      name: 'Wait for setup',
      targets: ['build-db', 'build-seed'],
      origin: 'authored',
    });
    expect(
      stepsOf(model)
        .slice(0, 2)
        .map((step) => step.joinedAt),
    ).toEqual([3, 3]);
  });

  it('resolves wait_all to the steps that are still outstanding', () => {
    const model = normalize([
      {key: 'a', background: true, run: 'a'},
      {key: 'b', background: true, run: 'b'},
      {key: 'c', background: true, run: 'c'},
      {wait: 'b'},
      {wait_all: null},
    ]);

    expect(stepsOf(model).slice(3).map(summary)).toEqual([
      {id: 'build-step-4', kind: 'wait', targets: ['build-b'], origin: 'authored'},
      {id: 'build-step-5', kind: 'wait', targets: ['build-a', 'build-c'], origin: 'authored'},
    ]);
    expect(
      stepsOf(model)
        .slice(0, 3)
        .map((step) => step.joinedAt),
    ).toEqual([5, 4, 5]);
  });

  it('accepts wait_all: true and a wait_all with nothing outstanding', () => {
    const model = normalize([{run: 'a'}, {wait_all: true}]);

    expect(summary(stepsOf(model)[1] as WorkflowModelStep)).toEqual({
      id: 'build-step-2',
      kind: 'wait',
      targets: [],
      origin: 'authored',
    });
  });

  it('resolves a cancel and leaves the stopped step unjoined', () => {
    const model = normalize([
      {key: 'db', background: true, run: 'docker run postgres'},
      {run: 'npm test'},
      {cancel: 'db'},
    ]);

    expect(stepsOf(model).map(summary)).toEqual([
      {id: 'build-db', kind: 'run', background: true},
      {id: 'build-step-2', kind: 'run'},
      {id: 'build-step-3', kind: 'cancel', targets: ['build-db']},
    ]);
  });
});

describe('the wait that closes the job', () => {
  it('is added when background steps are still outstanding', () => {
    const model = normalize([
      {key: 'upload', background: true, run: './upload.sh'},
      {run: 'npm run package'},
    ]);

    expect(stepsOf(model).map(summary)).toEqual([
      {id: 'build-upload', kind: 'run', background: true, joinedAt: 3},
      {id: 'build-step-2', kind: 'run'},
      {id: 'build-step-3', kind: 'wait', targets: ['build-upload'], origin: 'end-of-job'},
    ]);
  });

  it('is left out when every background step is joined or cancelled', () => {
    const model = normalize([
      {key: 'a', background: true, run: 'a'},
      {key: 'b', background: true, run: 'b'},
      {wait: 'a'},
      {cancel: 'b'},
    ]);

    expect(stepsOf(model).filter((step) => step.kind === 'wait')).toHaveLength(1);
    expect(stepsOf(model).at(-1)?.kind).toBe('cancel');
  });

  it('is left out when no step runs in the background', () => {
    expect(stepsOf(normalize([{run: 'a'}, {run: 'b'}])).map((step) => step.kind)).toEqual([
      'run',
      'run',
    ]);
  });
});

describe('the sync rules', () => {
  it('requires a key on a background step', () => {
    expect(issuesOf([{background: true, run: 'sleep 10'}])).toEqual([
      {
        code: 'background-key-required',
        path: 'jobs.build.steps.0.background',
        message: 'A background step needs a `key` so `wait` and `cancel` can name it.',
      },
    ]);
  });

  it('does not require a key on a parallel member', () => {
    expect(issuesOf([{parallel: [{run: 'a'}, {run: 'b'}]}])).toEqual([]);
  });

  it('rejects a gate on a background step', () => {
    expect(
      issuesOf([{key: 'a', background: true, run: 'a', gate: {success: 'true'}}, {wait: 'a'}]),
    ).toEqual([
      {
        code: 'concurrent-step-gate-unsupported',
        path: 'jobs.build.steps.0.gate',
        message: 'A gate cannot be used on a background or parallel step.',
      },
    ]);
  });

  it('rejects a checkout while a background step may run', () => {
    expect(
      issuesOf([{key: 'a', background: true, run: 'a'}, {checkout: {path: 'other'}}, {wait: 'a'}]),
    ).toEqual([
      {
        code: 'checkout-while-background-running',
        path: 'jobs.build.steps.1.checkout',
        message: 'A checkout step cannot run while background steps run. Add `wait_all` before it.',
      },
    ]);
  });

  it('allows a checkout after a wait or a cancel', () => {
    expect(
      issuesOf([
        {key: 'a', background: true, run: 'a'},
        {key: 'b', background: true, run: 'b'},
        {wait: 'a'},
        {cancel: 'b'},
        {checkout: {path: 'other'}},
      ]),
    ).toEqual([]);
  });

  it('allows a checkout after a parallel block, which joins its members', () => {
    expect(issuesOf([{parallel: [{run: 'a'}, {run: 'b'}]}, {checkout: {path: 'other'}}])).toEqual(
      [],
    );
  });

  it.each([
    ['a missing key', {wait: 'ghost'}, 'wait', 'ghost', 'but no background step has that key.'],
    ['a missing key', {cancel: 'ghost'}, 'cancel', 'ghost', 'but no background step has that key.'],
    [
      'a step that is not in the background',
      {wait: 'plain'},
      'wait',
      'plain',
      'but no background step has that key.',
    ],
  ])('rejects a wait or cancel that names %s', (_label, control, kind, name, reason) => {
    expect(issuesOf([{key: 'plain', run: 'echo'}, control])).toEqual([
      {
        code: 'concurrent-step-target-unknown',
        path: `jobs.build.steps.1.${kind}`,
        message: `\`${kind}\` names \`${name}\`, ${reason}`,
      },
    ]);
  });

  it.each([
    ['joined', {wait: 'a'}],
    ['cancelled', {cancel: 'a'}],
  ])('rejects a wait or cancel on a step that was already %s', (_label, first) => {
    const issues = issuesOf([{key: 'a', background: true, run: 'a'}, first, {wait: 'a'}]);

    expect(issues).toEqual([
      {
        code: 'concurrent-step-target-settled',
        path: 'jobs.build.steps.2.wait',
        message: '`wait` names `a`, but `a` was already joined or cancelled.',
      },
    ]);
  });

  it('points a bad name in a list at that name', () => {
    expect(
      issuesOf([{key: 'a', background: true, run: 'a'}, {wait: ['a', 'ghost']}]),
    ).toMatchObject([{code: 'concurrent-step-target-unknown', path: 'jobs.build.steps.1.wait.1'}]);
  });

  describe('gate restarts', () => {
    const gated = (restartFrom: string) => ({
      run: 'check',
      gate: {on_failure: {restart_from: restartFrom}},
    });

    it('rejects a restart_from past a background step that may still be running', () => {
      expect(
        issuesOf([
          {key: 'setup', run: 'setup'},
          {key: 'server', background: true, run: 'serve'},
          gated('setup'),
          {wait: 'server'},
        ]),
      ).toEqual([
        {
          code: 'gate-restart-past-background-step',
          path: 'jobs.build.steps.2.gate.on_failure',
          message: '`restart_from` cannot go back past `server`, which may still be running here.',
        },
      ]);
    });

    it('allows a restart_from after the background step is joined', () => {
      expect(
        issuesOf([
          {key: 'setup', run: 'setup'},
          {key: 'server', background: true, run: 'serve'},
          {wait: 'server'},
          gated('setup'),
        ]),
      ).toEqual([]);
    });

    it('allows a restart_from that stays after the background step', () => {
      expect(
        issuesOf([
          {key: 'server', background: true, run: 'serve'},
          {key: 'build', run: 'build'},
          gated('build'),
          {wait: 'server'},
        ]),
      ).toEqual([]);
    });

    it('rejects a restart_from that names a step in the middle of a parallel block', () => {
      expect(
        issuesOf([
          {
            parallel: [
              {key: 'left', run: 'a'},
              {key: 'right', run: 'b'},
            ],
          },
          gated('right'),
        ]),
      ).toEqual([
        {
          code: 'gate-restart-inside-parallel-block',
          path: 'jobs.build.steps.1.gate.on_failure',
          message:
            '`restart_from` cannot name `right`, a step in the middle of a `parallel` block. Restart from the first step of the block.',
        },
      ]);
    });

    it('allows a restart_from that names the first step of a parallel block', () => {
      expect(
        issuesOf([
          {
            parallel: [
              {key: 'left', run: 'a'},
              {key: 'right', run: 'b'},
            ],
          },
          gated('left'),
        ]),
      ).toEqual([]);
    });

    it('names the rule of a rule list', () => {
      expect(
        issuesOf([
          {key: 'setup', run: 'setup'},
          {key: 'server', background: true, run: 'serve'},
          {key: 'build', run: 'build'},
          {
            run: 'check',
            gate: {
              on_failure: [{if: 'false', restart_from: 'build'}, {restart_from: 'setup'}],
            },
          },
          {wait: 'server'},
        ]).map((issue) => issue.path),
      ).toEqual(['jobs.build.steps.3.gate.on_failure.1']);
    });
  });

  describe('agent sessions', () => {
    const agent = (key: string, session: unknown, extra: Step = {}) => ({
      key,
      prompt: `Work as ${key}.`,
      session,
      ...extra,
    });

    it('rejects two steps that share a session while one runs in the background', () => {
      expect(
        issuesOf([
          agent('first', 'shared', {background: true}),
          agent('second', 'shared'),
          {wait: 'first'},
        ]),
      ).toMatchObject([
        {
          code: 'agent-session-parallel-resume',
          path: 'jobs.build.steps.1.session',
          message: expect.stringContaining('can run at the same time'),
        },
      ]);
    });

    it('rejects two members of a parallel block that share a session', () => {
      expect(
        issuesOf([{parallel: [agent('first', 'shared'), agent('second', 'shared')]}]),
      ).toMatchObject([
        {code: 'agent-session-parallel-resume', path: 'jobs.build.steps.0.parallel.1.session'},
      ]);
    });

    it('allows the session once the first step is joined', () => {
      expect(
        issuesOf([
          agent('first', 'shared', {background: true}),
          {wait: 'first'},
          agent('second', 'shared'),
        ]),
      ).toEqual([]);
    });

    it('allows the session after the first step is cancelled', () => {
      expect(
        issuesOf([
          agent('first', 'shared', {background: true}),
          {cancel: 'first'},
          agent('second', 'shared'),
        ]),
      ).toEqual([]);
    });

    it('allows two forks of one session to run at the same time', () => {
      const fork = {key: 'shared', mode: 'fork'};

      expect(issuesOf([{parallel: [agent('first', fork), agent('second', fork)]}])).toEqual([]);
    });

    it('rejects a fork that runs next to a resume of the same session', () => {
      expect(
        issuesOf([
          {parallel: [agent('first', 'shared'), agent('second', {key: 'shared', mode: 'fork'})]},
        ]),
      ).toMatchObject([{code: 'agent-session-parallel-resume'}]);
    });

    it('compares session keys that depend on the job, since they resolve the same in one job', () => {
      const session = `review-${interpolation('job.key')}`;

      expect(
        issuesOf([{parallel: [agent('first', session), agent('second', session)]}]),
      ).toMatchObject([
        {code: 'agent-session-parallel-resume', path: 'jobs.build.steps.0.parallel.1.session'},
      ]);
    });

    it('does not compare job-dependent keys across jobs, which resolve differently', () => {
      const session = `review-${interpolation('job.key')}`;
      const step = {key: 'work', prompt: 'Work.', session};
      const document = parseWorkflowDocument(
        {
          name: 'two jobs',
          runner: 'ubuntu-latest',
          jobs: {one: {steps: [step]}, two: {steps: [step]}},
        },
        {concurrentSteps: true},
      );

      expect(() => normalizeWorkflowDocument(document, {agentValidationCatalog})).not.toThrow();
    });

    it('reports a broken session key once, even in a job named session', () => {
      const broken = interpolation('run.nope');
      const document = parseWorkflowDocument(
        {
          name: 'named session',
          runner: 'ubuntu-latest',
          jobs: {
            session: {
              steps: [{parallel: [agent('first', broken), agent('second', broken)]}],
            },
          },
        },
        {concurrentSteps: true},
      );

      let codes: string[] = [];
      try {
        normalizeWorkflowDocument(document, {agentValidationCatalog});
      } catch (error) {
        codes = (error as InvalidWorkflowModelError).issues.map((entry) => entry.code);
      }

      expect(codes).toEqual([
        'invalid-interpolation-expression',
        'invalid-interpolation-expression',
      ]);
    });

    it('allows different sessions to run at the same time', () => {
      expect(issuesOf([{parallel: [agent('first', 'one'), agent('second', 'two')]}])).toEqual([]);
    });
  });
});

describe('what a step can read', () => {
  const read = (source: string) => ({run: `echo ${interpolation(source)}`});
  const output = (key: string) => `steps.${key}.outputs.value`;
  const producing = (key: string, extra: Step = {}) => ({
    key,
    run: 'echo value',
    outputs: {value: {type: 'string'}},
    ...extra,
  });

  it('reads a step that is not in the background', () => {
    expect(issuesOf([producing('plain'), read(output('plain'))])).toEqual([]);
  });

  it('does not read a background step before its wait', () => {
    const issues = issuesOf([
      producing('slow', {background: true}),
      read(output('slow')),
      {wait: 'slow'},
    ]);

    expect(issues).toHaveLength(1);
    expect(issues[0]?.path).toBe('jobs.build.steps.1.run');
  });

  it('does not read a background step before its wait, even when no step declares outputs', () => {
    const issues = issuesOf([
      {key: 'slow', background: true, run: 'sleep 1'},
      read('steps.slow.status'),
      {wait: 'slow'},
    ]);

    expect(issues).toHaveLength(1);
    expect(issues[0]?.path).toBe('jobs.build.steps.1.run');
  });

  it('reads a joined background step when no step declares outputs', () => {
    expect(
      issuesOf([
        {key: 'slow', background: true, run: 'sleep 1'},
        {wait: 'slow'},
        read('steps.slow.status'),
      ]),
    ).toEqual([]);
  });

  it('explains why a background step is not readable', () => {
    const error = expectInvalid([
      producing('slow', {background: true}),
      read(output('slow')),
      {wait: 'slow'},
    ]);

    expect(error.issues[0]?.details?.reason).toContain(
      '`steps.slow` is not available here. Background steps are readable after a `wait` that joins them.',
    );
  });

  it('reads a background step after the wait that joins it', () => {
    expect(
      issuesOf([producing('slow', {background: true}), {wait: 'slow'}, read(output('slow'))]),
    ).toEqual([]);
  });

  it('does not read a step that finished first but is not joined', () => {
    const issues = issuesOf([
      producing('early', {background: true}),
      producing('late', {background: true}),
      {wait: 'late'},
      read(output('early')),
      {wait: 'early'},
    ]);

    expect(issues).toHaveLength(1);
    expect(issues[0]?.path).toBe('jobs.build.steps.3.run');
  });

  it('does not read a cancelled step', () => {
    const issues = issuesOf([
      producing('db', {background: true}),
      {cancel: 'db'},
      read(output('db')),
    ]);

    expect(issues).toHaveLength(1);
    expect(issues[0]?.path).toBe('jobs.build.steps.2.run');
  });

  it('does not let members of a parallel block read each other', () => {
    const issues = issuesOf([
      {parallel: [producing('left'), {run: `echo ${interpolation(output('left'))}`}]},
    ]);

    expect(issues).toHaveLength(1);
    expect(issues[0]?.path).toBe('jobs.build.steps.0.parallel.1.run');
  });

  it('lets a member read what ran before the block, and every member after it', () => {
    expect(
      issuesOf([
        producing('before'),
        {parallel: [producing('left'), {run: `echo ${interpolation(output('before'))}`}]},
        read(output('left')),
      ]),
    ).toEqual([]);
  });

  it('reads a background step in the job outputs once the closing wait joins it', () => {
    expect(
      issuesOf([producing('upload', {background: true})], {
        outputs: {result: interpolation(output('upload'))},
      }),
    ).toEqual([]);
  });

  it('does not read a cancelled step in the job outputs', () => {
    expect(
      issuesOf([producing('db', {background: true}), {cancel: 'db'}], {
        outputs: {result: interpolation(output('db'))},
      }),
    ).toHaveLength(1);
  });
});

describe('issue messages', () => {
  it('number a step as the document does', () => {
    const issues = issuesOf([
      {run: 'first'},
      {
        parallel: [
          {key: 'dup', run: 'a'},
          {key: 'dup', run: 'b'},
        ],
      },
    ]);

    expect(issues).toEqual([
      {
        code: 'duplicate-step-id',
        path: 'jobs.build.steps.1.parallel.1',
        message: 'Steps 1.0 and 1.1 in job "build" resolve to the same stable id "build-dup".',
      },
    ]);
  });
});

describe('issue paths', () => {
  it('point a step inside a parallel block at its document location', () => {
    const issues = issuesOf([
      {run: 'first'},
      {parallel: [{run: 'ok'}, {run: `echo ${interpolation('nope.value')}`}]},
    ]);

    expect(issues.map((issue) => issue.path)).toEqual(['jobs.build.steps.1.parallel.1.run']);
  });

  it('keep the numbering of the steps after a block', () => {
    const issues = issuesOf([
      {parallel: [{run: 'a'}, {run: 'b'}]},
      {run: `echo ${interpolation('nope.value')}`},
    ]);

    expect(issues.map((issue) => issue.path)).toEqual(['jobs.build.steps.1.run']);
  });
});

describe('the snapshot', () => {
  const snapshotOf = (steps: Step[]) => createWorkflowModelSnapshot(normalize(steps)).version;

  it('uses version 8 for a model with a background step', () => {
    expect(snapshotOf([{key: 'a', background: true, run: 'a'}, {wait: 'a'}])).toBe(8);
  });

  it('uses version 8 for a model with a parallel block', () => {
    expect(snapshotOf([{parallel: [{run: 'a'}, {run: 'b'}]}])).toBe(8);
  });

  it('keeps version 7 for continue_on_error alone', () => {
    expect(snapshotOf([{run: 'a', continue_on_error: true}])).toBe(7);
  });

  it('keeps version 3 for a plain job', () => {
    expect(snapshotOf([{run: 'a'}])).toBe(3);
  });
});
