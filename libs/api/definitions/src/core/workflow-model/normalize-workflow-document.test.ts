import type {WorkflowDocument} from '@shipfox/workflow-document';
import {InvalidWorkflowModelError} from './invalid-workflow-model-error.js';
import {normalizeWorkflowDocument as normalizeWorkflowDocumentBase} from './normalize-workflow-document.js';

function normalizeWorkflowDocument(
  document: WorkflowDocument,
  options?: Parameters<typeof normalizeWorkflowDocumentBase>[1],
) {
  return normalizeWorkflowDocumentBase({runner: 'ubuntu-latest', ...document}, options);
}

function expectInvalid(
  document: WorkflowDocument,
  options?: Parameters<typeof normalizeWorkflowDocumentBase>[1],
): InvalidWorkflowModelError {
  try {
    normalizeWorkflowDocument(document, options);
    expect.fail('Expected InvalidWorkflowModelError');
  } catch (error) {
    expect(error).toBeInstanceOf(InvalidWorkflowModelError);
    return error as InvalidWorkflowModelError;
  }
}

describe('normalizeWorkflowDocument', () => {
  it('normalizes a workflow document into a WorkflowModel', () => {
    const document: WorkflowDocument = {
      name: 'simple build',
      triggers: {
        main_push: {
          source: 'github',
          event: 'push',
          filter: 'event.ref == "refs/heads/main"',
        },
      },
      jobs: {
        build: {
          steps: [{run: 'npm install'}, {name: 'build', run: 'npm run build'}],
        },
      },
    };

    const model = normalizeWorkflowDocument(document);

    expect(model).toEqual({
      kind: 'workflow',
      name: 'simple build',
      triggers: [
        {
          id: 'main-push',
          sourceName: 'main_push',
          source: 'github',
          event: 'push',
          filter: 'event.ref == "refs/heads/main"',
        },
      ],
      jobs: [
        {
          id: 'build',
          sourceName: 'build',
          runner: ['ubuntu-latest'],
          dependencies: [],
          steps: [
            {
              id: 'build-step-1',
              kind: 'run',
              command: {kind: 'shell', value: 'npm install'},
            },
            {
              id: 'build-build',
              sourceName: 'build',
              kind: 'run',
              command: {kind: 'shell', value: 'npm run build'},
            },
          ],
        },
      ],
      dependencies: [],
    });
  });

  it('normalizes inline agent steps without resolving contextual defaults', () => {
    const document: WorkflowDocument = {
      name: 'agent build',
      jobs: {
        fix: {
          steps: [
            {name: 'plan', prompt: 'Plan the fix.'},
            {name: 'implement', model: 'claude-opus-4-8', prompt: 'Fix the failing tests.'},
            {
              name: 'review',
              model: 'gpt-5.5-pro',
              provider: 'openai',
              prompt: 'Review the fix.',
              thinking: 'low',
              gate: {success_if: 'exit_code == 0', on_failure: {restart_from: 'implement'}},
            },
          ],
        },
      },
    };

    const model = normalizeWorkflowDocument(document);

    expect(model.jobs[0]?.steps[0]).toEqual({
      id: 'fix-plan',
      sourceName: 'plan',
      kind: 'agent',
      prompt: 'Plan the fix.',
    });
    expect(model.jobs[0]?.steps[1]).toEqual({
      id: 'fix-implement',
      sourceName: 'implement',
      kind: 'agent',
      model: 'claude-opus-4-8',
      prompt: 'Fix the failing tests.',
    });
    expect(model.jobs[0]?.steps[2]).toMatchObject({
      id: 'fix-review',
      kind: 'agent',
      provider: 'openai',
      thinking: 'low',
      gate: {onFailure: {restartFrom: 'implement'}},
    });
  });

  it('reports unsupported explicit agent providers', () => {
    const document: WorkflowDocument = {
      name: 'agent build',
      jobs: {
        fix: {
          steps: [{provider: 'github-copilot', prompt: 'Fix it.'}],
        },
      },
    };

    const error = expectInvalid(document);

    expect(error.issues).toEqual([
      {
        code: 'invalid-agent-provider',
        message: 'Agent provider "github-copilot" is not supported.',
        path: ['jobs', 'fix', 'steps', 0, 'provider'],
        details: {provider: 'github-copilot'},
      },
    ]);
  });

  it('preserves explicit model ids even when the seed catalog only knows provider defaults', () => {
    const document: WorkflowDocument = {
      name: 'agent build',
      jobs: {
        fix: {
          steps: [{provider: 'openai', model: 'gpt-4.1', prompt: 'Fix it.'}],
        },
      },
    };

    const model = normalizeWorkflowDocument(document);

    expect(model.jobs[0]?.steps[0]).toMatchObject({
      kind: 'agent',
      provider: 'openai',
      model: 'gpt-4.1',
      prompt: 'Fix it.',
    });
  });

  it('applies top-level runner defaults to jobs without runner overrides', () => {
    const document: WorkflowDocument = {
      name: 'runner defaults',
      runner: ['ubuntu-latest', 'node-22'],
      jobs: {
        build: {
          steps: [{run: 'npm run build'}],
        },
        test: {
          runner: 'ubuntu-latest',
          steps: [{run: 'npm test'}],
        },
      },
    };

    const model = normalizeWorkflowDocument(document);

    expect(model.jobs).toMatchObject([
      {id: 'build', runner: ['node-22', 'ubuntu-latest']},
      {id: 'test', runner: ['ubuntu-latest']},
    ]);
  });

  it('canonicalizes runner labels', () => {
    const document: WorkflowDocument = {
      name: 'canonical runners',
      runner: [' Ubuntu-Latest ', 'gpu', 'ubuntu-latest', ' Node-22 '],
      jobs: {
        build: {
          steps: [{run: 'npm run build'}],
        },
      },
    };

    const model = normalizeWorkflowDocument(document);

    expect(model.jobs).toMatchObject([{id: 'build', runner: ['gpu', 'node-22', 'ubuntu-latest']}]);
  });

  it('reports a missing runner label when no default exists', () => {
    const document: WorkflowDocument = {
      name: 'missing runner',
      jobs: {
        build: {
          steps: [{run: 'npm run build'}],
        },
      },
    };

    try {
      normalizeWorkflowDocumentBase(document);
      expect.fail('Expected InvalidWorkflowModelError');
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidWorkflowModelError);
      expect((error as InvalidWorkflowModelError).issues).toEqual([
        expect.objectContaining({
          code: 'missing-runner-label',
          path: ['jobs', 'build', 'runner'],
        }),
      ]);
    }
  });

  it('uses canonicalized default runner labels when no runner is declared', () => {
    const document: WorkflowDocument = {
      name: 'default runner',
      jobs: {
        build: {
          steps: [{run: 'npm run build'}],
        },
      },
    };

    const model = normalizeWorkflowDocumentBase(document, {
      defaultRunnerLabels: [' Ubuntu ', 'ubuntu'],
    });

    expect(model.jobs).toMatchObject([{id: 'build', runner: ['ubuntu']}]);
  });

  it('does not fall back to defaults for explicit whitespace-only runner labels', () => {
    const document: WorkflowDocument = {
      name: 'empty explicit runner',
      runner: ' ',
      jobs: {
        build: {
          steps: [{run: 'npm run build'}],
        },
      },
    };

    try {
      normalizeWorkflowDocumentBase(document, {defaultRunnerLabels: ['ubuntu-latest']});
      expect.fail('Expected InvalidWorkflowModelError');
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidWorkflowModelError);
      expect((error as InvalidWorkflowModelError).issues).toEqual([
        expect.objectContaining({
          code: 'missing-runner-label',
          path: ['jobs', 'build', 'runner'],
        }),
      ]);
    }
  });

  it('canonicalizes job-level runner overrides over workflow-level runner labels', () => {
    const document: WorkflowDocument = {
      name: 'runner overrides',
      runner: ['ubuntu-latest'],
      jobs: {
        build: {
          runner: [' Node-22 ', 'node-22', 'GPU'],
          steps: [{run: 'npm run build'}],
        },
      },
    };

    const model = normalizeWorkflowDocument(document);

    expect(model.jobs).toMatchObject([{id: 'build', runner: ['gpu', 'node-22']}]);
  });

  it('reports invalid runner labels', () => {
    const document: WorkflowDocument = {
      name: 'invalid runner',
      runner: 'ci,gpu',
      jobs: {
        build: {
          steps: [{run: 'npm run build'}],
        },
      },
    };

    try {
      normalizeWorkflowDocumentBase(document);
      expect.fail('Expected InvalidWorkflowModelError');
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidWorkflowModelError);
      expect((error as InvalidWorkflowModelError).issues).toEqual([
        expect.objectContaining({
          code: 'invalid-runner-label',
          path: ['jobs', 'build', 'runner'],
          details: {labels: ['ci,gpu']},
        }),
      ]);
    }
  });

  it('reports too many runner labels', () => {
    const document: WorkflowDocument = {
      name: 'too many runners',
      runner: Array.from({length: 21}, (_, index) => `label-${index}`),
      jobs: {
        build: {
          steps: [{run: 'npm run build'}],
        },
      },
    };

    try {
      normalizeWorkflowDocumentBase(document);
      expect.fail('Expected InvalidWorkflowModelError');
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidWorkflowModelError);
      expect((error as InvalidWorkflowModelError).issues).toEqual([
        expect.objectContaining({
          code: 'too-many-runner-labels',
          path: ['jobs', 'build', 'runner'],
        }),
      ]);
    }
  });

  it('reports invalid labels and too many labels together', () => {
    const document: WorkflowDocument = {
      name: 'invalid and too many runners',
      runner: ['has space', ...Array.from({length: 20}, (_, index) => `label-${index}`)],
      jobs: {
        build: {
          steps: [{run: 'npm run build'}],
        },
      },
    };

    try {
      normalizeWorkflowDocumentBase(document);
      expect.fail('Expected InvalidWorkflowModelError');
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidWorkflowModelError);
      expect((error as InvalidWorkflowModelError).issues).toEqual([
        expect.objectContaining({
          code: 'invalid-runner-label',
          path: ['jobs', 'build', 'runner'],
          details: {labels: ['has space']},
        }),
        expect.objectContaining({
          code: 'too-many-runner-labels',
          path: ['jobs', 'build', 'runner'],
        }),
      ]);
    }
  });

  it('accepts the maximum runner label count', () => {
    const document: WorkflowDocument = {
      name: 'maximum runner count',
      runner: Array.from({length: 20}, (_, index) => `label-${index}`),
      jobs: {
        build: {
          steps: [{run: 'npm run build'}],
        },
      },
    };

    const model = normalizeWorkflowDocumentBase(document);

    expect(model.jobs[0]?.runner).toHaveLength(20);
  });

  it('expands a top-level runner string shorthand', () => {
    const document: WorkflowDocument = {
      name: 'runner shorthand',
      runner: 'ubuntu-latest',
      jobs: {
        build: {
          steps: [{run: 'npm run build'}],
        },
      },
    };

    const model = normalizeWorkflowDocument(document);

    expect(model.jobs).toMatchObject([{id: 'build', runner: ['ubuntu-latest']}]);
  });

  it('stringifies env at workflow, job, and run-step scope', () => {
    const document: WorkflowDocument = {
      name: 'env build',
      env: {NODE_ENV: 'test', PORT: 3000, CI: true},
      jobs: {
        build: {
          env: {JOB_SCOPE: 'build'},
          steps: [{run: 'npm test', env: {STEP_SCOPE: 'test', DEBUG: false}}],
        },
      },
    };

    const model = normalizeWorkflowDocument(document);

    expect(model.env).toEqual({NODE_ENV: 'test', PORT: '3000', CI: 'true'});
    expect(model.jobs[0]?.env).toEqual({JOB_SCOPE: 'build'});
    expect(model.jobs[0]?.steps[0]).toMatchObject({
      kind: 'run',
      env: {STEP_SCOPE: 'test', DEBUG: 'false'},
    });
  });

  it('omits empty env maps and does not attach inherited env to agent steps', () => {
    const document: WorkflowDocument = {
      name: 'agent env',
      env: {},
      jobs: {
        fix: {
          env: {JOB_SCOPE: 'fix'},
          steps: [{model: 'claude-opus-4-8', prompt: 'Fix it.'}],
        },
      },
    };

    const model = normalizeWorkflowDocument(document);

    expect(model).not.toHaveProperty('env');
    expect(model.jobs[0]?.env).toEqual({JOB_SCOPE: 'fix'});
    expect(model.jobs[0]?.steps[0]).not.toHaveProperty('env');
  });

  it('expands needs into job dependencies and explicit graph edges', () => {
    const document: WorkflowDocument = {
      name: 'graph',
      jobs: {
        'build app': {
          steps: [{run: 'npm run build'}],
        },
        test: {
          needs: 'build app',
          steps: [{run: 'npm test'}],
        },
        deploy: {
          needs: ['build app', 'test'],
          steps: [{run: 'npm run deploy'}],
        },
      },
    };

    const model = normalizeWorkflowDocument(document);

    expect(model.jobs.map((job) => ({id: job.id, dependencies: job.dependencies}))).toEqual([
      {id: 'build-app', dependencies: []},
      {id: 'test', dependencies: ['build-app']},
      {id: 'deploy', dependencies: ['build-app', 'test']},
    ]);
    expect(model.dependencies).toEqual([
      {from: 'build-app', to: 'test'},
      {from: 'build-app', to: 'deploy'},
      {from: 'test', to: 'deploy'},
    ]);
  });

  it('deduplicates repeated needs before building graph edges', () => {
    const document: WorkflowDocument = {
      name: 'dedupe graph',
      jobs: {
        build: {
          steps: [{run: 'npm run build'}],
        },
        test: {
          needs: ['build', 'build'],
          steps: [{run: 'npm test'}],
        },
      },
    };

    const model = normalizeWorkflowDocument(document);

    expect(model.jobs).toMatchObject([
      {id: 'build', dependencies: []},
      {id: 'test', dependencies: ['build']},
    ]);
    expect(model.dependencies).toEqual([{from: 'build', to: 'test'}]);
  });

  it('normalizes step gates with success conditions and failure actions', () => {
    const reviewOutput = 'Agent rejected the PR $' + '{{ step.output.review }}';
    const document: WorkflowDocument = {
      name: 'review loop',
      jobs: {
        review: {
          steps: [
            {name: 'producer', run: 'npm run build'},
            {
              name: 'reviewer',
              run: 'npm run review',
              gate: {
                success_if: 'exit_code == 0',
                on_failure: {
                  restart_from: 'producer',
                  output: reviewOutput,
                },
              },
            },
          ],
        },
      },
    };

    const model = normalizeWorkflowDocument(document);

    expect(model.jobs[0]?.steps[1]).toMatchObject({
      id: 'review-reviewer',
      sourceName: 'reviewer',
      gate: {
        successIf: {
          language: 'cel',
          source: 'exit_code == 0',
          check: 'typed',
        },
        onFailure: {
          restartFrom: 'producer',
          output: reviewOutput,
        },
      },
    });
  });

  it('normalizes run step exit-code gates', () => {
    const document: WorkflowDocument = {
      name: 'simple build',
      jobs: {
        build: {
          steps: [{name: 'build', run: 'npm run build', gate: {success_if: 'exit_code == 0'}}],
        },
      },
    };

    const model = normalizeWorkflowDocument(document);

    expect(model.jobs[0]?.steps[0]?.gate?.successIf).toEqual({
      language: 'cel',
      source: 'exit_code == 0',
      check: 'typed',
    });
  });

  it('normalizes on_failure-only gates', () => {
    const document: WorkflowDocument = {
      name: 'retry build',
      jobs: {
        build: {
          steps: [
            {name: 'install', run: 'npm install'},
            {name: 'build', run: 'npm run build', gate: {on_failure: {restart_from: 'install'}}},
          ],
        },
      },
    };

    const model = normalizeWorkflowDocument(document);

    expect(model.jobs[0]?.steps[1]?.gate).toEqual({
      onFailure: {restartFrom: 'install'},
    });
  });

  it('reports invalid gate success_if expressions', () => {
    const document: WorkflowDocument = {
      name: 'invalid gate',
      jobs: {
        build: {
          steps: [{run: 'npm run build', gate: {success_if: 'step.output.pass == true'}}],
        },
      },
    };

    const error = expectInvalid(document);

    expect(error.issues).toEqual([
      expect.objectContaining({
        code: 'invalid-step-gate-success-if',
        path: ['jobs', 'build', 'steps', 0, 'gate', 'success_if'],
        details: expect.objectContaining({source: 'step.output.pass == true'}),
      }),
    ]);
  });

  it('reports gate restart_from references to unknown steps', () => {
    const document: WorkflowDocument = {
      name: 'invalid gate',
      jobs: {
        build: {
          steps: [
            {
              name: 'review',
              run: 'npm run review',
              gate: {on_failure: {restart_from: 'producer'}},
            },
          ],
        },
      },
    };

    const error = expectInvalid(document);

    expect(error.issues).toEqual([
      {
        code: 'invalid-step-gate-restart-from',
        message: 'Step "build-review" must restart from an earlier named step; found "producer".',
        path: ['jobs', 'build', 'steps', 0, 'gate', 'on_failure'],
        details: {stepId: 'build-review', restartFrom: 'producer'},
      },
    ]);
  });

  it('reports gate restart_from references to the same step', () => {
    const document: WorkflowDocument = {
      name: 'invalid gate',
      jobs: {
        build: {
          steps: [
            {
              name: 'review',
              run: 'npm run review',
              gate: {on_failure: {restart_from: 'review'}},
            },
          ],
        },
      },
    };

    const error = expectInvalid(document);

    expect(error.issues).toEqual([
      {
        code: 'invalid-step-gate-restart-from',
        message: 'Step "build-review" must restart from an earlier named step; found "review".',
        path: ['jobs', 'build', 'steps', 0, 'gate', 'on_failure'],
        details: {stepId: 'build-review', restartFrom: 'review'},
      },
    ]);
  });

  it('reports gate restart_from references to later steps', () => {
    const document: WorkflowDocument = {
      name: 'invalid gate',
      jobs: {
        build: {
          steps: [
            {
              name: 'review',
              run: 'npm run review',
              gate: {on_failure: {restart_from: 'producer'}},
            },
            {name: 'producer', run: 'npm run build'},
          ],
        },
      },
    };

    const error = expectInvalid(document);

    expect(error.issues).toEqual([
      {
        code: 'invalid-step-gate-restart-from',
        message: 'Step "build-review" must restart from an earlier named step; found "producer".',
        path: ['jobs', 'build', 'steps', 0, 'gate', 'on_failure'],
        details: {stepId: 'build-review', restartFrom: 'producer'},
      },
    ]);
  });

  it('reports unknown dependencies', () => {
    const document: WorkflowDocument = {
      name: 'unknown dependency',
      jobs: {
        test: {
          needs: 'build',
          steps: [{run: 'npm test'}],
        },
      },
    };

    const error = expectInvalid(document);

    expect(error.issues).toEqual([
      {
        code: 'unknown-job-dependency',
        message: 'Job "test" depends on unknown job "build".',
        path: ['jobs', 'test', 'needs'],
        details: {job: 'test', dependency: 'build'},
      },
    ]);
  });

  it('reports self dependencies', () => {
    const document: WorkflowDocument = {
      name: 'self dependency',
      jobs: {
        test: {
          needs: 'test',
          steps: [{run: 'npm test'}],
        },
      },
    };

    const error = expectInvalid(document);

    expect(error.issues).toEqual([
      {
        code: 'self-job-dependency',
        message: 'Job "test" depends on itself.',
        path: ['jobs', 'test', 'needs'],
        details: {job: 'test'},
      },
    ]);
  });

  it('reports dependency cycles', () => {
    const document: WorkflowDocument = {
      name: 'cycle',
      jobs: {
        build: {
          needs: 'test',
          steps: [{run: 'npm run build'}],
        },
        test: {
          needs: 'build',
          steps: [{run: 'npm test'}],
        },
      },
    };

    const error = expectInvalid(document);

    expect(error.issues).toEqual([
      {
        code: 'job-dependency-cycle',
        message: 'Circular dependency detected among jobs: build, test.',
        path: ['jobs'],
        details: {cycleSourceNames: ['build', 'test'], cycleJobIds: ['build', 'test']},
      },
    ]);
  });

  it('reports stable job id collisions', () => {
    const document: WorkflowDocument = {
      name: 'collision',
      jobs: {
        'build app': {
          steps: [{run: 'npm run build'}],
        },
        'build-app': {
          steps: [{run: 'npm run build'}],
        },
      },
    };

    const error = expectInvalid(document);

    expect(error.issues).toEqual([
      {
        code: 'duplicate-job-id',
        message: 'Job names "build app" and "build-app" resolve to the same stable id "build-app".',
        path: ['jobs', 'build-app'],
        details: {id: 'build-app', sourceNames: ['build app', 'build-app']},
      },
    ]);
  });

  it('normalizes trimmed and symbolic job names into stable ids', () => {
    const document: WorkflowDocument = {
      name: 'stable ids',
      jobs: {
        '  Build App  ': {
          steps: [{run: 'npm run build'}],
        },
        '!!!': {
          steps: [{run: 'npm test'}],
        },
      },
    };

    const model = normalizeWorkflowDocument(document);

    expect(model.jobs.map((job) => ({id: job.id, sourceName: job.sourceName}))).toEqual([
      {id: 'build-app', sourceName: '  Build App  '},
      {id: 'unnamed', sourceName: '!!!'},
    ]);
  });

  it('reports stable trigger id collisions', () => {
    const document: WorkflowDocument = {
      name: 'trigger collision',
      triggers: {
        main_push: {source: 'github', event: 'push'},
        'main push': {source: 'github', event: 'push'},
      },
      jobs: {
        build: {
          steps: [{run: 'npm run build'}],
        },
      },
    };

    const error = expectInvalid(document);

    expect(error.issues).toEqual([
      {
        code: 'duplicate-trigger-id',
        message:
          'Trigger names "main_push" and "main push" resolve to the same stable id "main-push".',
        path: ['triggers', 'main push'],
        details: {id: 'main-push', sourceNames: ['main_push', 'main push']},
      },
    ]);
  });

  it('reports stable step id collisions inside a job', () => {
    const document: WorkflowDocument = {
      name: 'step collision',
      jobs: {
        build: {
          steps: [{run: 'npm install'}, {name: 'step 1', run: 'npm test'}],
        },
      },
    };

    const error = expectInvalid(document);

    expect(error.issues).toEqual([
      {
        code: 'duplicate-step-id',
        message: 'Steps 0 and 1 in job "build" resolve to the same stable id "build-step-1".',
        path: ['jobs', 'build', 'steps', 1],
        details: {id: 'build-step-1', indexes: [0, 1]},
      },
    ]);
  });

  it('keeps trigger filters as source strings until event typed expressions are introduced', () => {
    const document: WorkflowDocument = {
      name: 'deferred trigger filter',
      triggers: {
        main: {
          source: 'github',
          event: 'push',
          filter: 'event.conclsion == "success"',
        },
      },
      jobs: {
        build: {
          steps: [{run: 'npm run build'}],
        },
      },
    };

    const model = normalizeWorkflowDocument(document);

    expect(model.triggers).toEqual([
      {
        id: 'main',
        sourceName: 'main',
        source: 'github',
        event: 'push',
        filter: 'event.conclsion == "success"',
      },
    ]);
  });

  it('maps trigger with values to model inputs', () => {
    const document: WorkflowDocument = {
      name: 'inputs',
      triggers: {
        dispatch: {
          source: 'github',
          event: 'workflow_dispatch',
          with: {environment: 'production'},
        },
      },
      jobs: {
        build: {
          steps: [{run: 'npm run build'}],
        },
      },
    };

    const model = normalizeWorkflowDocument(document);

    expect(model.triggers).toEqual([
      {
        id: 'dispatch',
        sourceName: 'dispatch',
        source: 'github',
        event: 'workflow_dispatch',
        inputs: {environment: 'production'},
      },
    ]);
  });

  it('allows a single manual trigger', () => {
    const document: WorkflowDocument = {
      name: 'manual trigger',
      triggers: {
        manual: {source: 'manual', event: 'fire'},
      },
      jobs: {
        build: {
          steps: [{run: 'npm run build'}],
        },
      },
    };

    const model = normalizeWorkflowDocument(document);

    expect(model.triggers).toMatchObject([{id: 'manual', source: 'manual', event: 'fire'}]);
  });

  it('reports multiple manual triggers as a semantic rule', () => {
    const document: WorkflowDocument = {
      name: 'manual triggers',
      triggers: {
        one: {source: 'manual', event: 'fire'},
        two: {source: 'manual', event: 'fire'},
      },
      jobs: {
        build: {
          steps: [{run: 'npm run build'}],
        },
      },
    };

    const error = expectInvalid(document);

    expect(error.issues).toEqual([
      {
        code: 'multiple-manual-triggers',
        message: 'A workflow may declare at most one manual trigger; found 2: one, two.',
        path: ['triggers'],
        details: {manualTriggerNames: ['one', 'two']},
      },
    ]);
  });

  it('accumulates independent semantic issues in one pass', () => {
    const document: WorkflowDocument = {
      name: 'many issues',
      jobs: {
        'test app': {
          needs: 'missing',
          steps: [{run: 'npm test'}],
        },
        'test-app': {
          needs: 'test-app',
          steps: [{run: 'npm test'}],
        },
        lint: {
          needs: 'lint',
          steps: [{run: 'npm run lint'}],
        },
      },
    };

    const error = expectInvalid(document);

    expect(error.issues.map((issue) => issue.code)).toEqual([
      'duplicate-job-id',
      'unknown-job-dependency',
      'self-job-dependency',
    ]);
  });
});
