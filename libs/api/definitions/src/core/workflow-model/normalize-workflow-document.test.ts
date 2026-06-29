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

  it('reports non-boolean gate success_if expressions', () => {
    const document: WorkflowDocument = {
      name: 'non-boolean gate',
      jobs: {
        build: {
          steps: [{run: 'npm run build', gate: {success_if: 'exit_code + 1'}}],
        },
      },
    };

    const error = expectInvalid(document);

    expect(error.issues).toEqual([
      expect.objectContaining({
        code: 'invalid-step-gate-success-if',
        path: ['jobs', 'build', 'steps', 0, 'gate', 'success_if'],
        details: expect.objectContaining({
          source: 'exit_code + 1',
          reason: expect.stringContaining('must return bool'),
        }),
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

  it('reports only cycle members for dependencies blocked by a cycle', () => {
    const document: WorkflowDocument = {
      name: 'cycle with dependent',
      jobs: {
        build: {
          needs: 'test',
          steps: [{run: 'npm run build'}],
        },
        test: {
          needs: 'build',
          steps: [{run: 'npm test'}],
        },
        deploy: {
          needs: 'build',
          steps: [{run: 'npm run deploy'}],
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

  describe('definition-time interpolation', () => {
    const interpolation = (source: string) => '$'.concat('{{ ', source, ' }}');

    it('stores parsed templates for run, env, prompt, and step name fields', () => {
      const document: WorkflowDocument = {
        name: 'templated workflow',
        env: {RUN_ID: interpolation('run.id'), PORT: 3000},
        jobs: {
          build: {
            env: {JOB_NAME: interpolation('job.name')},
            steps: [
              {
                name: `deploy ${interpolation('event.action')}`,
                run: `deploy ${interpolation('run.id')}`,
                env: {PR_TITLE: interpolation('event.pull_request.title'), DEBUG: false},
              },
              {
                name: `review ${interpolation('inputs.topic')}`,
                provider: 'openai',
                prompt: `Review ${interpolation('event.pull_request.title')}`,
              },
            ],
          },
        },
      };

      const model = normalizeWorkflowDocument(document);

      expect(model.templates?.env?.RUN_ID).toEqual([
        {
          kind: 'expr',
          expression: {language: 'cel', source: 'run.id', check: 'typed'},
          contextRoots: ['run'],
        },
      ]);
      expect(model.templates?.env).not.toHaveProperty('PORT');
      expect(model.jobs[0]?.templates?.env?.JOB_NAME).toEqual([
        {
          kind: 'expr',
          expression: {language: 'cel', source: 'job.name', check: 'typed'},
          contextRoots: ['job'],
        },
      ]);
      expect(model.jobs[0]?.steps[0]).toMatchObject({
        kind: 'run',
        command: {value: `deploy ${interpolation('run.id')}`},
        templates: {
          command: [
            {kind: 'literal', text: 'deploy '},
            {
              kind: 'expr',
              expression: {language: 'cel', source: 'run.id', check: 'typed'},
              contextRoots: ['run'],
            },
          ],
          name: [
            {kind: 'literal', text: 'deploy '},
            {
              kind: 'expr',
              expression: {language: 'cel', source: 'event.action', check: 'syntax'},
              contextRoots: ['event'],
            },
          ],
          env: {
            PR_TITLE: [
              {
                kind: 'expr',
                expression: {
                  language: 'cel',
                  source: 'event.pull_request.title',
                  check: 'syntax',
                },
                contextRoots: ['event'],
              },
            ],
          },
        },
      });
      expect(model.jobs[0]?.steps[1]).toMatchObject({
        kind: 'agent',
        templates: {
          prompt: [
            {kind: 'literal', text: 'Review '},
            {
              kind: 'expr',
              expression: {
                language: 'cel',
                source: 'event.pull_request.title',
                check: 'syntax',
              },
              contextRoots: ['event'],
            },
          ],
          name: [
            {kind: 'literal', text: 'review '},
            {
              kind: 'expr',
              expression: {language: 'cel', source: 'inputs.topic', check: 'syntax'},
              contextRoots: ['inputs'],
            },
          ],
        },
      });
    });

    it('omits templates for pure literal and escaped interpolation text', () => {
      const document: WorkflowDocument = {
        name: 'literal workflow',
        env: {VALUE: '$${{ event.ref }}'},
        jobs: {
          build: {
            steps: [{name: 'literal step', run: 'echo $${{ event.ref }}'}],
          },
        },
      };

      const model = normalizeWorkflowDocument(document);

      expect(model).not.toHaveProperty('templates');
      expect(model.jobs[0]?.steps[0]).not.toHaveProperty('templates');
      expect(model.env).toEqual({VALUE: '$${{ event.ref }}'});
      expect(model.jobs[0]?.steps[0]).toMatchObject({
        kind: 'run',
        command: {value: 'echo $${{ event.ref }}'},
      });
    });

    it('preserves env keys that look like object prototype properties', () => {
      const document: WorkflowDocument = {
        name: 'prototype env',
        env: {['__proto__']: interpolation('event.name')},
        jobs: {
          build: {
            env: {['__proto__']: 'job-value'},
            steps: [
              {
                run: 'echo ok',
                env: {['__proto__']: interpolation('inputs.value')},
              },
            ],
          },
        },
      };

      const model = normalizeWorkflowDocument(document);
      const workflowEnv = model.env ?? {};
      const jobEnv = model.jobs[0]?.env ?? {};
      const step = model.jobs[0]?.steps[0];
      if (step?.kind !== 'run') expect.fail('Expected a run step');
      const stepEnv = step.env ?? {};
      const workflowTemplates = model.templates?.env ?? {};
      const stepTemplates = step.templates?.env ?? {};

      expect(Object.hasOwn(workflowEnv, '__proto__')).toBe(true);
      expect(Object.hasOwn(jobEnv, '__proto__')).toBe(true);
      expect(Object.hasOwn(stepEnv, '__proto__')).toBe(true);
      expect(Object.getOwnPropertyDescriptor(workflowEnv, '__proto__')?.value).toBe(
        interpolation('event.name'),
      );
      expect(Object.getOwnPropertyDescriptor(jobEnv, '__proto__')?.value).toBe('job-value');
      expect(Object.getOwnPropertyDescriptor(stepEnv, '__proto__')?.value).toBe(
        interpolation('inputs.value'),
      );
      expect(
        Object.getOwnPropertyDescriptor(workflowTemplates, '__proto__')?.value?.[0],
      ).toMatchObject({
        kind: 'expr',
        contextRoots: ['event'],
      });
      expect(Object.getOwnPropertyDescriptor(stepTemplates, '__proto__')?.value?.[0]).toMatchObject(
        {
          kind: 'expr',
          contextRoots: ['inputs'],
        },
      );
    });

    it('rejects untrusted context in run commands with the env fix-it message', () => {
      const document: WorkflowDocument = {
        name: 'unsafe run',
        jobs: {
          build: {
            steps: [{run: `echo ${interpolation('event.pull_request.title')}`}],
          },
        },
      };

      const error = expectInvalid(document);

      expect(error.issues).toEqual([
        expect.objectContaining({
          code: 'untrusted-context-in-field',
          path: ['jobs', 'build', 'steps', 0, 'run'],
          message: expect.stringContaining('Bind untrusted values to env'),
          details: expect.objectContaining({
            field: 'run',
            rejectedRoots: ['event'],
          }),
        }),
      ]);
    });

    it('allows untrusted context in env, prompt, and step names', () => {
      const document: WorkflowDocument = {
        name: 'untrusted allowed',
        env: {EVENT_NAME: interpolation('event.name')},
        jobs: {
          build: {
            steps: [
              {name: interpolation('event.action'), run: 'echo ok'},
              {provider: 'openai', prompt: interpolation('inputs.prompt')},
            ],
          },
        },
      };

      const model = normalizeWorkflowDocument(document);

      expect(model.templates?.env?.EVENT_NAME?.[0]).toMatchObject({
        kind: 'expr',
        expression: {check: 'syntax'},
        contextRoots: ['event'],
      });
      expect(model.jobs[0]?.steps[0]).toMatchObject({
        kind: 'run',
        templates: {name: [{kind: 'expr', contextRoots: ['event']}]},
      });
      expect(model.jobs[0]?.steps[1]).toMatchObject({
        kind: 'agent',
        templates: {prompt: [{kind: 'expr', contextRoots: ['inputs']}]},
      });
    });

    it.each([
      ['model', {model: interpolation('event.model'), prompt: 'Fix it.'}, 'event'],
      ['provider', {provider: interpolation('inputs.provider'), prompt: 'Fix it.'}, 'inputs'],
    ] as const)('rejects untrusted agent %s interpolation', (_field, step, root) => {
      const document: WorkflowDocument = {
        name: 'unsafe agent field',
        jobs: {
          fix: {
            steps: [step],
          },
        },
      };

      const error = expectInvalid(document);

      expect(error.issues).toEqual([
        expect.objectContaining({
          code: 'untrusted-context-in-field',
          details: expect.objectContaining({rejectedRoots: [root]}),
        }),
      ]);
    });

    it.each([
      ['model', {model: interpolation('foo.bar'), prompt: 'Fix it.'}],
      ['provider', {provider: interpolation('foo.bar'), prompt: 'Fix it.'}],
    ] as const)('rejects unknown context roots in agent %s interpolation', (_field, step) => {
      const document: WorkflowDocument = {
        name: 'unknown agent context',
        jobs: {
          fix: {
            steps: [step],
          },
        },
      };

      const error = expectInvalid(document);

      expect(error.issues).toEqual([
        expect.objectContaining({
          code: 'unknown-interpolation-context',
          details: expect.objectContaining({unknownRoots: ['foo']}),
        }),
      ]);
    });

    it.each([
      ['model', {model: interpolation('run.name'), prompt: 'Fix it.'}],
      ['provider', {provider: interpolation('run.name'), prompt: 'Fix it.'}],
    ] as const)('rejects trusted agent %s interpolation until resolution lands', (_field, step) => {
      const document: WorkflowDocument = {
        name: 'unsupported agent field',
        jobs: {
          fix: {
            steps: [step],
          },
        },
      };

      const error = expectInvalid(document);

      expect(error.issues).toEqual([
        expect.objectContaining({
          code: 'interpolation-not-supported',
          message: expect.stringContaining('ENG-637'),
        }),
      ]);
    });

    it('still validates literal agent providers through the catalog', () => {
      const document: WorkflowDocument = {
        name: 'literal provider',
        jobs: {
          fix: {
            steps: [{provider: 'github-copilot', prompt: 'Fix it.'}],
          },
        },
      };

      const error = expectInvalid(document);

      expect(error.issues).toEqual([
        expect.objectContaining({
          code: 'invalid-agent-provider',
          path: ['jobs', 'fix', 'steps', 0, 'provider'],
        }),
      ]);
    });

    it('reports typed interpolation expression errors for trusted known contexts', () => {
      const document: WorkflowDocument = {
        name: 'bad trusted path',
        env: {BAD: interpolation('run.nope')},
        jobs: {
          build: {
            steps: [{run: 'echo ok'}],
          },
        },
      };

      const error = expectInvalid(document);

      expect(error.issues).toEqual([
        expect.objectContaining({
          code: 'invalid-interpolation-expression',
          path: ['env', 'BAD'],
          details: expect.objectContaining({
            field: 'env.value',
            expression: 'run.nope',
            contextRoots: ['run'],
          }),
        }),
      ]);
    });

    it('reports malformed interpolation templates before expression validation', () => {
      const document: WorkflowDocument = {
        name: 'bad template',
        env: {BAD: 'deploy ${{ event.ref'},
        jobs: {
          build: {
            steps: [{run: 'echo ok'}],
          },
        },
      };

      const error = expectInvalid(document);

      expect(error.issues).toEqual([
        expect.objectContaining({
          code: 'invalid-interpolation-template',
          path: ['env', 'BAD'],
          details: expect.objectContaining({field: 'env.value'}),
        }),
      ]);
    });

    it('reports unknown interpolation context roots', () => {
      const document: WorkflowDocument = {
        name: 'unknown context',
        env: {BAD: interpolation('foo.bar')},
        jobs: {
          build: {
            steps: [{run: 'echo ok'}],
          },
        },
      };

      const error = expectInvalid(document);

      expect(error.issues).toEqual([
        expect.objectContaining({
          code: 'unknown-interpolation-context',
          path: ['env', 'BAD'],
          details: expect.objectContaining({
            contextRoots: ['foo'],
            unknownRoots: ['foo'],
          }),
        }),
      ]);
    });

    it('type-checks merged trusted contexts and reports bad fields from either root', () => {
      const validDocument: WorkflowDocument = {
        name: 'merged contexts',
        env: {VALID: interpolation('run.name + trigger.source')},
        jobs: {
          build: {
            steps: [{run: 'echo ok'}],
          },
        },
      };
      const invalidDocument: WorkflowDocument = {
        name: 'bad merged contexts',
        env: {BAD: interpolation('run.name + trigger.nope')},
        jobs: {
          build: {
            steps: [{run: 'echo ok'}],
          },
        },
      };

      const model = normalizeWorkflowDocument(validDocument);
      const error = expectInvalid(invalidDocument);

      expect(model.templates?.env?.VALID?.[0]).toMatchObject({
        kind: 'expr',
        expression: {check: 'typed'},
        contextRoots: ['run', 'trigger'],
      });
      expect(error.issues).toEqual([
        expect.objectContaining({
          code: 'invalid-interpolation-expression',
          path: ['env', 'BAD'],
        }),
      ]);
    });

    it('uses syntax mode for mixed open contexts but still enforces minimum trust', () => {
      const envDocument: WorkflowDocument = {
        name: 'mixed env',
        env: {MIXED: interpolation('run.nope + event.x')},
        jobs: {
          build: {
            steps: [{run: 'echo ok'}],
          },
        },
      };
      const runDocument: WorkflowDocument = {
        name: 'mixed run',
        jobs: {
          build: {
            steps: [{run: `echo ${interpolation('run.id + event.x')}`}],
          },
        },
      };

      const model = normalizeWorkflowDocument(envDocument);
      const error = expectInvalid(runDocument);

      expect(model.templates?.env?.MIXED?.[0]).toMatchObject({
        kind: 'expr',
        expression: {check: 'syntax'},
        contextRoots: expect.arrayContaining(['run', 'event']),
      });
      expect(error.issues).toEqual([
        expect.objectContaining({
          code: 'untrusted-context-in-field',
          path: ['jobs', 'build', 'steps', 0, 'run'],
        }),
      ]);
    });

    it('reports one trust issue for a multi-segment run field with one untrusted segment', () => {
      const document: WorkflowDocument = {
        name: 'multi segment run',
        jobs: {
          build: {
            steps: [{run: `${interpolation('run.id')}-${interpolation('event.x')}`}],
          },
        },
      };

      const error = expectInvalid(document);

      expect(error.issues).toEqual([
        expect.objectContaining({
          code: 'untrusted-context-in-field',
          details: expect.objectContaining({rejectedRoots: ['event']}),
        }),
      ]);
    });

    it('does not parse templates in non-string env values', () => {
      const document: WorkflowDocument = {
        name: 'non-string env',
        env: {COUNT: 1, ENABLED: true},
        jobs: {
          build: {
            env: {LIMIT: 10},
            steps: [{run: 'echo ok', env: {DEBUG: false}}],
          },
        },
      };

      const model = normalizeWorkflowDocument(document);

      expect(model.env).toEqual({COUNT: '1', ENABLED: 'true'});
      expect(model).not.toHaveProperty('templates');
      expect(model.jobs[0]).not.toHaveProperty('templates');
      expect(model.jobs[0]?.steps[0]).toMatchObject({
        kind: 'run',
        env: {DEBUG: 'false'},
      });
      expect(model.jobs[0]?.steps[0]).not.toHaveProperty('templates');
    });
  });
});
