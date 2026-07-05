import type {WorkflowDocument} from '@shipfox/workflow-document';
import {InvalidWorkflowModelError} from './invalid-workflow-model-error.js';
import {DEFAULT_JOB_CHECKOUT} from './normalize-job-checkout.js';
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
          steps: [{run: 'npm install'}, {key: 'build', run: 'npm run build'}],
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
          key: 'main_push',
          source: 'github',
          event: 'push',
          filter: 'event.ref == "refs/heads/main"',
        },
      ],
      jobs: [
        {
          id: 'build',
          mode: 'one_shot',
          key: 'build',
          runner: ['ubuntu-latest'],
          checkout: DEFAULT_JOB_CHECKOUT,
          dependencies: [],
          steps: [
            {
              id: 'build-step-1',
              kind: 'run',
              command: {kind: 'shell', value: 'npm install'},
            },
            {
              id: 'build-build',
              key: 'build',
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
            {key: 'plan', prompt: 'Plan the fix.'},
            {key: 'implement', model: 'claude-opus-4-8', prompt: 'Fix the failing tests.'},
            {
              key: 'review',
              model: 'gpt-5.5-pro',
              provider: 'openai',
              prompt: 'Review the fix.',
              thinking: 'low',
              gate: {success_if: 'step.exit_code == 0', on_failure: {restart_from: 'implement'}},
            },
          ],
        },
      },
    };

    const model = normalizeWorkflowDocument(document);

    expect(model.jobs[0]?.steps[0]).toEqual({
      id: 'fix-plan',
      key: 'plan',
      kind: 'agent',
      prompt: 'Plan the fix.',
    });
    expect(model.jobs[0]?.steps[1]).toEqual({
      id: 'fix-implement',
      key: 'implement',
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

  it('reports unsupported explicit providers', () => {
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
        code: 'invalid-provider',
        message: 'Provider "github-copilot" is not supported.',
        path: ['jobs', 'fix', 'steps', 0, 'provider'],
        details: {provider: 'github-copilot'},
      },
    ]);
  });

  it('normalizes job success expressions and execution timeouts', () => {
    const document: WorkflowDocument = {
      name: 'job controls',
      jobs: {
        test: {
          success: 'executions.exists(e, e.index == 0 && e.status == "succeeded")',
          execution_timeout: '90m',
          steps: [{run: 'npm test'}],
        },
      },
    };

    const model = normalizeWorkflowDocument(document);

    expect(model.jobs[0]).toMatchObject({
      success: 'executions.exists(e, e.index == 0 && e.status == "succeeded")',
      executionTimeoutMs: 90 * 60 * 1000,
    });
  });

  it('defaults omitted job checkout to read permissions and persisted credentials', () => {
    const document: WorkflowDocument = {
      name: 'default checkout',
      jobs: {
        build: {
          steps: [{run: 'npm test'}],
        },
      },
    };

    const model = normalizeWorkflowDocument(document);

    expect(model.jobs[0]?.checkout).toEqual(DEFAULT_JOB_CHECKOUT);
  });

  it('defaults empty job checkout to read permissions and persisted credentials', () => {
    const document: WorkflowDocument = {
      name: 'empty checkout',
      jobs: {
        build: {
          checkout: {},
          steps: [{run: 'npm test'}],
        },
      },
    };

    const model = normalizeWorkflowDocument(document);

    expect(model.jobs[0]?.checkout).toEqual(DEFAULT_JOB_CHECKOUT);
  });

  it('normalizes checkout contents write and defaults persisted credentials', () => {
    const document: WorkflowDocument = {
      name: 'write checkout',
      jobs: {
        build: {
          checkout: {
            permissions: {
              contents: 'write',
            },
          },
          steps: [{run: 'npm test'}],
        },
      },
    };

    const model = normalizeWorkflowDocument(document);

    expect(model.jobs[0]?.checkout).toEqual({
      permissions: {contents: 'write'},
      persistCredentials: true,
    });
  });

  it('normalizes checkout persist credentials false and defaults contents read', () => {
    const document: WorkflowDocument = {
      name: 'no persisted credentials',
      jobs: {
        build: {
          checkout: {'persist-credentials': false},
          steps: [{run: 'npm test'}],
        },
      },
    };

    const model = normalizeWorkflowDocument(document);

    expect(model.jobs[0]?.checkout).toEqual({
      permissions: {contents: 'read'},
      persistCredentials: false,
    });
  });

  it('normalizes listening job configuration', () => {
    const displayName = ['PR review $', '{{ execution.index }}'].join('');
    const promptTemplate = ['Review $', '{{ execution.events[0].data.body }}'].join('');
    const document: WorkflowDocument = {
      name: 'listen for reviews',
      jobs: {
        review: {
          name: displayName,
          listening: {
            on: [
              {
                source: 'github',
                event: 'pull_request_review',
                filter: 'event.action == "submitted"',
              },
            ],
            until: [{source: 'github', event: 'pull_request', filter: 'event.action == "closed"'}],
            timeout: '30d',
            max_executions: 10,
            batch: {debounce: '5s', max_size: 20, max_wait: '1h'},
            on_resolve: 'cancel',
          },
          steps: [{prompt: promptTemplate}],
        },
      },
    };

    const model = normalizeWorkflowDocument(document);

    expect(model.jobs[0]).toMatchObject({
      mode: 'listening',
      listening: {
        on: [
          {source: 'github', event: 'pull_request_review', filter: 'event.action == "submitted"'},
        ],
        until: [{source: 'github', event: 'pull_request', filter: 'event.action == "closed"'}],
        timeoutMs: 30 * 24 * 60 * 60 * 1000,
        maxExecutions: 10,
        batch: {debounceMs: 5000, maxSize: 20, maxWaitMs: 60 * 60 * 1000},
        onResolve: 'cancel',
      },
    });
    expect(model.jobs[0]?.name?.[1]).toMatchObject({
      kind: 'deferred',
      expression: {source: 'execution.index', check: 'typed'},
    });
  });

  it('reports listening jobs without a resolution source', () => {
    const document: WorkflowDocument = {
      name: 'listen forever',
      jobs: {
        review: {
          listening: {
            on: [{source: 'github', event: 'pull_request_review'}],
          },
          steps: [{run: 'echo ok'}],
        },
      },
    };

    const error = expectInvalid(document);

    expect(error.issues).toEqual([
      expect.objectContaining({
        code: 'listening-job-missing-resolution-source',
        path: ['jobs', 'review', 'listening'],
      }),
    ]);
  });

  it('reports listening timeouts above the run timeout', () => {
    const document: WorkflowDocument = {
      name: 'too long',
      jobs: {
        review: {
          listening: {
            on: [{source: 'github', event: 'pull_request_review'}],
            timeout: '31d',
          },
          steps: [{run: 'echo ok'}],
        },
      },
    };

    const error = expectInvalid(document);

    expect(error.issues).toEqual([
      expect.objectContaining({
        code: 'listening-timeout-exceeds-run-timeout',
        path: ['jobs', 'review', 'listening', 'timeout'],
      }),
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
    const reviewOutput = 'Agent rejected the PR $' + '{{ step.outputs.review }}';
    const document: WorkflowDocument = {
      name: 'review loop',
      jobs: {
        review: {
          steps: [
            {key: 'producer', run: 'npm run build'},
            {
              key: 'reviewer',
              run: 'npm run review',
              gate: {
                success_if: 'step.exit_code == 0',
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
      key: 'reviewer',
      gate: {
        successIf: {
          language: 'cel',
          source: 'step.exit_code == 0',
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
          steps: [{name: 'build', run: 'npm run build', gate: {success_if: 'step.exit_code == 0'}}],
        },
      },
    };

    const model = normalizeWorkflowDocument(document);

    expect(model.jobs[0]?.steps[0]?.gate?.successIf).toEqual({
      language: 'cel',
      source: 'step.exit_code == 0',
      check: 'typed',
    });
  });

  it('accepts step.status in a gate success_if', () => {
    const document: WorkflowDocument = {
      name: 'status gate',
      jobs: {
        build: {
          steps: [{run: 'npm run build', gate: {success_if: 'step.status == "succeeded"'}}],
        },
      },
    };

    const model = normalizeWorkflowDocument(document);

    expect(model.jobs[0]?.steps[0]?.gate?.successIf).toEqual({
      language: 'cel',
      source: 'step.status == "succeeded"',
      check: 'typed',
    });
  });

  it('accepts server roots available at step reporting in gate success_if', () => {
    const document: WorkflowDocument = {
      name: 'server-context gate',
      jobs: {
        build: {steps: [{run: 'npm run build', gate: {success_if: 'run.id != ""'}}]},
      },
    };

    const model = normalizeWorkflowDocument(document);

    expect(model.jobs[0]?.steps[0]?.gate?.successIf).toEqual({
      language: 'cel',
      source: 'run.id != ""',
      check: 'typed',
    });
  });

  it('rejects runner-host roots in gate success_if with a server-predicate issue', () => {
    const document: WorkflowDocument = {
      name: 'runner-context gate',
      jobs: {
        build: {
          steps: [{run: 'npm run build', gate: {success_if: 'runner.os == "linux"'}}],
        },
      },
    };

    const error = expectInvalid(document);

    expect(error.issues).toEqual([
      expect.objectContaining({
        code: 'runner-context-in-server-predicate',
        message: expect.stringContaining('cannot reference runner context "runner"'),
        path: ['jobs', 'build', 'steps', 0, 'gate', 'success_if'],
        details: expect.objectContaining({
          field: 'step.success_if',
          source: 'runner.os == "linux"',
          runnerRoots: ['runner'],
          site: 'step-report',
        }),
      }),
    ]);
  });

  it('rejects vars in gate success_if with a server-predicate issue', () => {
    const document: WorkflowDocument = {
      name: 'vars-context gate',
      jobs: {
        build: {
          steps: [{run: 'npm run build', gate: {success_if: 'vars.REQUIRED == "true"'}}],
        },
      },
    };

    const error = expectInvalid(document);

    expect(error.issues).toEqual([
      expect.objectContaining({
        code: 'vars-context-in-server-predicate',
        message: expect.stringContaining('cannot reference vars'),
        path: ['jobs', 'build', 'steps', 0, 'gate', 'success_if'],
        details: expect.objectContaining({
          field: 'step.success_if',
          source: 'vars.REQUIRED == "true"',
          rejectedRoots: ['vars'],
          site: 'step-report',
        }),
      }),
    ]);
  });

  it('rejects contexts unavailable at the gate predicate site', () => {
    const document: WorkflowDocument = {
      name: 'future-context gate',
      jobs: {
        build: {
          steps: [{run: 'npm run build', gate: {success_if: 'jobs.deploy.status == "succeeded"'}}],
        },
        deploy: {needs: ['build'], steps: [{run: 'npm run deploy'}]},
      },
    };

    const error = expectInvalid(document);

    expect(error.issues).toEqual([
      expect.objectContaining({
        code: 'context-unavailable-at-predicate-site',
        path: ['jobs', 'build', 'steps', 0, 'gate', 'success_if'],
        details: expect.objectContaining({
          field: 'step.success_if',
          source: 'jobs.deploy.status == "succeeded"',
          unavailableRoots: ['jobs'],
          site: 'step-report',
        }),
      }),
    ]);
  });

  it('accepts execution fields and event data in job success expressions', () => {
    const document: WorkflowDocument = {
      name: 'full-shape job success',
      jobs: {
        build: {
          success:
            'executions.all(e, e.name != "") && executions.all(e, e.events.all(ev, ev.data.ok == true))',
          steps: [{run: 'npm run build'}],
        },
      },
    };

    const model = normalizeWorkflowDocument(document);

    expect(model.jobs[0]?.success).toBe(
      'executions.all(e, e.name != "") && executions.all(e, e.events.all(ev, ev.data.ok == true))',
    );
  });

  it('reports invalid job success expressions', () => {
    const document: WorkflowDocument = {
      name: 'invalid job success',
      jobs: {
        build: {
          success: 'executions.exists(e, e.status == )',
          steps: [{run: 'npm run build'}],
        },
      },
    };

    const error = expectInvalid(document);

    expect(error.issues).toEqual([
      expect.objectContaining({
        code: 'invalid-job-success',
        path: ['jobs', 'build', 'success'],
        details: expect.objectContaining({source: 'executions.exists(e, e.status == )'}),
      }),
    ]);
  });

  it('reports non-boolean job success expressions', () => {
    const document: WorkflowDocument = {
      name: 'non-boolean job success',
      jobs: {
        build: {
          success: 'executions.size()',
          steps: [{run: 'npm run build'}],
        },
      },
    };

    const error = expectInvalid(document);

    expect(error.issues).toEqual([
      expect.objectContaining({
        code: 'invalid-job-success',
        path: ['jobs', 'build', 'success'],
        details: expect.objectContaining({
          source: 'executions.size()',
          reason: expect.stringContaining('must return bool'),
        }),
      }),
    ]);
  });

  it('reports rootless non-boolean job success expressions', () => {
    const document: WorkflowDocument = {
      name: 'rootless non-boolean job success',
      jobs: {
        build: {
          success: '1 + 2',
          steps: [{run: 'npm run build'}],
        },
      },
    };

    const error = expectInvalid(document);

    expect(error.issues).toEqual([
      expect.objectContaining({
        code: 'invalid-job-success',
        path: ['jobs', 'build', 'success'],
        details: expect.objectContaining({
          source: '1 + 2',
          reason: expect.stringContaining('must return bool'),
        }),
      }),
    ]);
  });

  it('reports misspelled execution fields in job success expressions', () => {
    const document: WorkflowDocument = {
      name: 'misspelled job success',
      jobs: {
        build: {
          success: 'executions.all(e, e.statsu == "succeeded")',
          steps: [{run: 'npm run build'}],
        },
      },
    };

    const error = expectInvalid(document);

    expect(error.issues).toEqual([
      expect.objectContaining({
        code: 'invalid-job-success',
        path: ['jobs', 'build', 'success'],
        details: expect.objectContaining({
          source: 'executions.all(e, e.statsu == "succeeded")',
          reason: expect.stringContaining('statsu'),
        }),
      }),
    ]);
  });

  it('rejects runner-host roots in job success with a server-predicate issue', () => {
    const document: WorkflowDocument = {
      name: 'runner-context job success',
      jobs: {
        build: {
          success: 'runner.os == "linux"',
          steps: [{run: 'npm run build'}],
        },
      },
    };

    const error = expectInvalid(document);

    expect(error.issues).toEqual([
      expect.objectContaining({
        code: 'runner-context-in-server-predicate',
        message: expect.stringContaining('cannot reference runner context "runner"'),
        path: ['jobs', 'build', 'success'],
        details: expect.objectContaining({
          field: 'job.success',
          source: 'runner.os == "linux"',
          runnerRoots: ['runner'],
          site: 'job-resolution',
        }),
      }),
    ]);
  });

  it('rejects vars in job success with a server-predicate issue', () => {
    const document: WorkflowDocument = {
      name: 'vars-context job success',
      jobs: {
        build: {
          success: 'vars.ENVIRONMENT == "prod"',
          steps: [{run: 'npm run build'}],
        },
      },
    };

    const error = expectInvalid(document);

    expect(error.issues).toEqual([
      expect.objectContaining({
        code: 'vars-context-in-server-predicate',
        message: expect.stringContaining('cannot reference vars'),
        path: ['jobs', 'build', 'success'],
        details: expect.objectContaining({
          field: 'job.success',
          source: 'vars.ENVIRONMENT == "prod"',
          rejectedRoots: ['vars'],
          site: 'job-resolution',
        }),
      }),
    ]);
  });

  it('reports malformed job execution timeouts', () => {
    const document: WorkflowDocument = {
      name: 'invalid timeout',
      jobs: {
        build: {
          execution_timeout: 'ten minutes',
          steps: [{run: 'npm run build'}],
        },
      },
    };

    const error = expectInvalid(document);

    expect(error.issues).toEqual([
      {
        code: 'invalid-duration',
        message: 'Duration must be an integer followed by ms, s, m, h, or d.',
        path: ['jobs', 'build', 'execution_timeout'],
        details: {source: 'ten minutes'},
      },
    ]);
  });

  it('reports job execution timeouts below 1s', () => {
    const document: WorkflowDocument = {
      name: 'short timeout',
      jobs: {
        build: {
          execution_timeout: '999ms',
          steps: [{run: 'npm run build'}],
        },
      },
    };

    const error = expectInvalid(document);

    expect(error.issues).toEqual([
      {
        code: 'invalid-duration',
        message: 'Duration must be between 1s and 24h.',
        path: ['jobs', 'build', 'execution_timeout'],
        details: {source: '999ms', min_ms: 1000, max_ms: 24 * 60 * 60 * 1000},
      },
    ]);
  });

  it('reports job execution timeouts above 24h', () => {
    const document: WorkflowDocument = {
      name: 'long timeout',
      jobs: {
        build: {
          execution_timeout: '25h',
          steps: [{run: 'npm run build'}],
        },
      },
    };

    const error = expectInvalid(document);

    expect(error.issues).toEqual([
      {
        code: 'invalid-duration',
        message: 'Duration must be between 1s and 24h.',
        path: ['jobs', 'build', 'execution_timeout'],
        details: {source: '25h', min_ms: 1000, max_ms: 24 * 60 * 60 * 1000},
      },
    ]);
  });

  it('reports day-based job execution timeouts above 24h', () => {
    const document: WorkflowDocument = {
      name: 'long timeout',
      jobs: {
        build: {
          execution_timeout: '30d',
          steps: [{run: 'npm run build'}],
        },
      },
    };

    const error = expectInvalid(document);

    expect(error.issues).toEqual([
      {
        code: 'invalid-duration',
        message: 'Duration must be between 1s and 24h.',
        path: ['jobs', 'build', 'execution_timeout'],
        details: {source: '30d', min_ms: 1000, max_ms: 24 * 60 * 60 * 1000},
      },
    ]);
  });

  it('normalizes on_failure-only gates', () => {
    const document: WorkflowDocument = {
      name: 'retry build',
      jobs: {
        build: {
          steps: [
            {key: 'install', run: 'npm install'},
            {key: 'build', run: 'npm run build', gate: {on_failure: {restart_from: 'install'}}},
          ],
        },
      },
    };

    const model = normalizeWorkflowDocument(document);

    expect(model.jobs[0]?.steps[1]?.gate).toEqual({
      onFailure: {restartFrom: 'install'},
    });
  });

  it('accepts step outputs in gate success_if expressions', () => {
    const document: WorkflowDocument = {
      name: 'output gate',
      jobs: {
        build: {
          steps: [{run: 'npm run build', gate: {success_if: 'step.outputs.pass == true'}}],
        },
      },
    };

    const model = normalizeWorkflowDocument(document);

    expect(model.jobs[0]?.steps[0]?.gate?.successIf).toEqual({
      language: 'cel',
      source: 'step.outputs.pass == true',
      check: 'typed',
    });
  });

  it('reports non-boolean gate success_if expressions', () => {
    const document: WorkflowDocument = {
      name: 'non-boolean gate',
      jobs: {
        build: {
          steps: [{run: 'npm run build', gate: {success_if: 'step.exit_code + 1'}}],
        },
      },
    };

    const error = expectInvalid(document);

    expect(error.issues).toEqual([
      expect.objectContaining({
        code: 'invalid-step-gate-success-if',
        path: ['jobs', 'build', 'steps', 0, 'gate', 'success_if'],
        details: expect.objectContaining({
          source: 'step.exit_code + 1',
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
              key: 'review',
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
        message: 'Step "build-review" must restart from an earlier keyed step; found "producer".',
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
              key: 'review',
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
        message: 'Step "build-review" must restart from an earlier keyed step; found "review".',
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
              key: 'review',
              run: 'npm run review',
              gate: {on_failure: {restart_from: 'producer'}},
            },
            {key: 'producer', run: 'npm run build'},
          ],
        },
      },
    };

    const error = expectInvalid(document);

    expect(error.issues).toEqual([
      {
        code: 'invalid-step-gate-restart-from',
        message: 'Step "build-review" must restart from an earlier keyed step; found "producer".',
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
        message: 'Job keys "build app" and "build-app" resolve to the same stable id "build-app".',
        path: ['jobs', 'build-app'],
        details: {id: 'build-app', sourceKeys: ['build app', 'build-app']},
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

    expect(model.jobs.map((job) => ({id: job.id, key: job.key}))).toEqual([
      {id: 'build-app', key: '  Build App  '},
      {id: 'unnamed', key: '!!!'},
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
          'Trigger keys "main_push" and "main push" resolve to the same stable id "main-push".',
        path: ['triggers', 'main push'],
        details: {id: 'main-push', sourceKeys: ['main_push', 'main push']},
      },
    ]);
  });

  it('reports stable step id collisions inside a job', () => {
    const document: WorkflowDocument = {
      name: 'step collision',
      jobs: {
        build: {
          steps: [{run: 'npm install'}, {key: 'step 1', run: 'npm test'}],
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
        key: 'main',
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
        key: 'dispatch',
        source: 'github',
        event: 'workflow_dispatch',
        inputs: {environment: 'production'},
      },
    ]);
  });

  it('normalizes a valid cron trigger with the default timezone', () => {
    const document: WorkflowDocument = {
      name: 'nightly trigger',
      triggers: {
        nightly: {
          source: 'cron',
          event: 'tick',
          config: {schedule: '0 2 * * *'},
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
        id: 'nightly',
        key: 'nightly',
        source: 'cron',
        event: 'tick',
        config: {
          schedule: '0 2 * * *',
          timezone: 'UTC',
        },
      },
    ]);
  });

  it('normalizes a valid cron trigger with an explicit timezone', () => {
    const document: WorkflowDocument = {
      name: 'nightly trigger',
      triggers: {
        nightly: {
          source: 'cron',
          event: 'tick',
          config: {
            schedule: '0 2 * * *',
            timezone: 'Europe/Paris',
          },
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
        id: 'nightly',
        key: 'nightly',
        source: 'cron',
        event: 'tick',
        config: {
          schedule: '0 2 * * *',
          timezone: 'Europe/Paris',
        },
      },
    ]);
  });

  it('reports a cron trigger with a non-tick event', () => {
    const document: WorkflowDocument = {
      name: 'nightly trigger',
      triggers: {
        nightly: {
          source: 'cron',
          event: 'push',
          config: {schedule: '0 2 * * *'},
        },
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
        code: 'invalid-cron-event',
        message: 'A cron trigger must use event "tick"; found "push".',
        path: ['triggers', 'nightly', 'event'],
        details: {event: 'push'},
      },
    ]);
  });

  it('reports a cron trigger without a schedule', () => {
    const document: WorkflowDocument = {
      name: 'nightly trigger',
      triggers: {
        nightly: {
          source: 'cron',
          event: 'tick',
        },
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
        code: 'missing-cron-schedule',
        message: 'A cron trigger requires a schedule.',
        path: ['triggers', 'nightly', 'schedule'],
      },
    ]);
  });

  it.each([
    ['malformed', 'not a cron'],
    ['6-field', '0 0 2 * * *'],
    ['preset', '@daily'],
  ])('reports an invalid %s cron schedule', (_label, schedule) => {
    const document: WorkflowDocument = {
      name: 'nightly trigger',
      triggers: {
        nightly: {
          source: 'cron',
          event: 'tick',
          config: {schedule},
        },
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
        code: 'invalid-cron-schedule',
        message: 'Cron trigger schedule must be a valid 5-field cron expression.',
        path: ['triggers', 'nightly', 'schedule'],
        details: {schedule},
      },
    ]);
  });

  it('reports an invalid cron timezone', () => {
    const document: WorkflowDocument = {
      name: 'nightly trigger',
      triggers: {
        nightly: {
          source: 'cron',
          event: 'tick',
          config: {
            schedule: '0 2 * * *',
            timezone: 'Not/A/Zone',
          },
        },
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
        code: 'invalid-cron-timezone',
        message: 'Cron trigger timezone must be a valid IANA time zone.',
        path: ['triggers', 'nightly', 'timezone'],
        details: {timezone: 'Not/A/Zone'},
      },
    ]);
  });

  it('allows multiple cron triggers', () => {
    const document: WorkflowDocument = {
      name: 'cron triggers',
      triggers: {
        hourly: {
          source: 'cron',
          event: 'tick',
          config: {schedule: '0 * * * *'},
        },
        nightly: {
          source: 'cron',
          event: 'tick',
          config: {schedule: '0 2 * * *'},
        },
      },
      jobs: {
        build: {
          steps: [{run: 'npm run build'}],
        },
      },
    };

    const model = normalizeWorkflowDocument(document);

    expect(model.triggers.map((trigger) => trigger.key)).toEqual(['hourly', 'nightly']);
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
        details: {manualTriggerKeys: ['one', 'two']},
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
    const listening = () => ({
      on: [{source: 'github', event: 'pull_request_review'}],
      max_executions: 1,
    });

    it('stores parsed templates for run, env, prompt, and step name fields', () => {
      const document: WorkflowDocument = {
        name: 'templated workflow',
        env: {RUN_ID: interpolation('run.id'), PORT: 3000},
        jobs: {
          build: {
            env: {JOB_NAME: interpolation('job.key')},
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
          kind: 'deferred',
          expression: {language: 'cel', source: 'run.id', check: 'typed'},
          roots: ['run'],
          fillTarget: 'run-creation',
        },
      ]);
      expect(model.templates?.env).not.toHaveProperty('PORT');
      expect(model.jobs[0]?.templates?.env?.JOB_NAME).toEqual([
        {
          kind: 'deferred',
          expression: {language: 'cel', source: 'job.key', check: 'typed'},
          roots: ['job'],
          fillTarget: 'run-creation',
        },
      ]);
      expect(model.jobs[0]?.steps[0]).toMatchObject({
        kind: 'run',
        command: {value: `deploy ${interpolation('run.id')}`},
        templates: {
          command: [
            {kind: 'literal', value: 'deploy '},
            {
              kind: 'deferred',
              expression: {language: 'cel', source: 'run.id', check: 'typed'},
              roots: ['run'],
            },
          ],
          name: [
            {kind: 'literal', value: 'deploy '},
            {
              kind: 'deferred',
              expression: {language: 'cel', source: 'event.action', check: 'syntax'},
              roots: ['event'],
            },
          ],
          env: {
            PR_TITLE: [
              {
                kind: 'deferred',
                expression: {
                  language: 'cel',
                  source: 'event.pull_request.title',
                  check: 'syntax',
                },
                roots: ['event'],
              },
            ],
          },
        },
      });
      expect(model.jobs[0]?.steps[1]).toMatchObject({
        kind: 'agent',
        templates: {
          prompt: [
            {kind: 'literal', value: 'Review '},
            {
              kind: 'deferred',
              expression: {
                language: 'cel',
                source: 'event.pull_request.title',
                check: 'syntax',
              },
              roots: ['event'],
            },
          ],
          name: [
            {kind: 'literal', value: 'review '},
            {
              kind: 'deferred',
              expression: {language: 'cel', source: 'inputs.topic', check: 'syntax'},
              roots: ['inputs'],
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
            name: 'Build app',
            steps: [{name: 'literal step', run: 'echo $${{ event.ref }}'}],
          },
        },
      };

      const model = normalizeWorkflowDocument(document);

      expect(model).not.toHaveProperty('templates');
      expect(model.jobs[0]?.steps[0]).not.toHaveProperty('templates');
      expect(model.env).toEqual({VALUE: '$${{ event.ref }}'});
      expect(model.jobs[0]?.name).toEqual([{kind: 'literal', value: 'Build app'}]);
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
        kind: 'deferred',
        roots: ['event'],
      });
      expect(Object.getOwnPropertyDescriptor(stepTemplates, '__proto__')?.value?.[0]).toMatchObject(
        {
          kind: 'deferred',
          roots: ['inputs'],
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

    it('rejects secrets in agent fields', () => {
      const document: WorkflowDocument = {
        name: 'agent secret',
        jobs: {
          build: {
            steps: [{prompt: interpolation('secrets.OPENAI_API_KEY')}],
          },
        },
      };

      const error = expectInvalid(document);

      expect(error.issues).toEqual([
        expect.objectContaining({
          code: 'runner-context-in-field',
          details: expect.objectContaining({rejectedRoots: ['secrets']}),
        }),
      ]);
    });

    it('rejects computed vars keys', () => {
      const document: WorkflowDocument = {
        name: 'computed vars',
        jobs: {
          build: {
            steps: [{run: 'echo ok', env: {REGION: interpolation('vars[event.region]')}}],
          },
        },
      };

      const error = expectInvalid(document);

      expect(error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'computed-context-key',
            details: expect.objectContaining({root: 'vars'}),
          }),
        ]),
      );
      expect(error.issues.map((issue) => issue.code)).toEqual([
        'computed-context-key',
        'computed-context-key',
      ]);
    });

    it('rejects unknown secret stores', () => {
      const document: WorkflowDocument = {
        name: 'unknown secret store',
        jobs: {
          build: {
            steps: [{run: 'echo ok', env: {TOKEN: interpolation('secrets.vault.TOKEN')}}],
          },
        },
      };

      const error = expectInvalid(document);

      expect(error.issues).toEqual([
        expect.objectContaining({
          code: 'unknown-secret-store',
          details: expect.objectContaining({store: 'vault'}),
        }),
      ]);
    });

    it.each([
      'execution.events[0].data.body',
      'execution["events"][0].data.body',
      'execution[x]',
    ])('rejects untrusted execution sub-paths in run commands: %s', (source) => {
      const document: WorkflowDocument = {
        name: 'unsafe execution run',
        jobs: {
          build: {
            steps: [{run: `echo ${interpolation(source)}`}],
          },
        },
      };

      const error = expectInvalid(document);

      expect(error.issues).toEqual([
        expect.objectContaining({
          code: 'untrusted-context-in-field',
          path: ['jobs', 'build', 'steps', 0, 'run'],
          details: expect.objectContaining({
            field: 'run',
            rejectedRoots: ['execution'],
          }),
        }),
      ]);
    });

    it('rejects execution event access through CEL comprehension bindings in run commands', () => {
      const document: WorkflowDocument = {
        name: 'unsafe execution map run',
        jobs: {
          build: {
            steps: [{run: `echo ${interpolation('executions.map(e, e.events[0].data.body)')}`}],
          },
        },
      };

      const error = expectInvalid(document);

      expect(error.issues).toEqual([
        expect.objectContaining({
          code: 'untrusted-context-in-field',
          path: ['jobs', 'build', 'steps', 0, 'run'],
          details: expect.objectContaining({
            field: 'run',
            rejectedRoots: ['executions'],
          }),
        }),
      ]);
    });

    it.each([
      ['run', {run: `echo ${interpolation('execution.index')}`}],
      [
        'step-level env',
        {run: 'echo ok', env: {EXECUTION_INDEX: interpolation('execution.index')}},
      ],
      ['step name', {name: interpolation('execution.index'), run: 'echo ok'}],
    ] as const)('allows one-shot %s interpolation when execution context is available by dispatch', (_field, step) => {
      const document: WorkflowDocument = {
        name: 'dispatch execution context',
        jobs: {
          build: {
            steps: [step],
          },
        },
      };

      const model = normalizeWorkflowDocument(document);

      expect(model.jobs[0]?.steps).toHaveLength(1);
    });

    it.each([
      ['run', {run: `echo ${interpolation('execution.index')}`}],
      [
        'step-level env',
        {run: 'echo ok', env: {EXECUTION_INDEX: interpolation('execution.index')}},
      ],
      ['step name', {name: interpolation('execution.index'), run: 'echo ok'}],
    ] as const)('allows listening job %s interpolation when execution context is available', (_field, step) => {
      const document: WorkflowDocument = {
        name: 'execution context',
        jobs: {
          build: {
            listening: listening(),
            steps: [step],
          },
        },
      };

      const model = normalizeWorkflowDocument(document);

      expect(model.jobs[0]?.mode).toBe('listening');
    });

    it.each([
      ['prompt', {prompt: interpolation('execution.index')}],
      ['model', {model: interpolation('execution.name'), prompt: 'Fix it.'}],
      ['provider', {provider: interpolation('execution.name'), prompt: 'Fix it.'}],
    ] as const)('allows one-shot agent %s interpolation when execution context is available by dispatch', (_field, step) => {
      const document: WorkflowDocument = {
        name: 'dispatch agent context',
        jobs: {
          fix: {
            steps: [step],
          },
        },
      };

      const model = normalizeWorkflowDocument(document);

      expect(model.jobs[0]?.steps).toHaveLength(1);
    });

    it.each([
      ['prompt', {prompt: interpolation('execution.index')}],
      ['model', {model: interpolation('execution.name'), prompt: 'Fix it.'}],
      ['provider', {provider: interpolation('execution.name'), prompt: 'Fix it.'}],
    ] as const)('allows listening job agent %s interpolation when execution context is available', (_field, step) => {
      const document: WorkflowDocument = {
        name: 'agent execution context',
        jobs: {
          fix: {
            listening: listening(),
            steps: [step],
          },
        },
      };

      const model = normalizeWorkflowDocument(document);

      expect(model.jobs[0]?.mode).toBe('listening');
    });

    it('rejects step context before step reporting', () => {
      const document: WorkflowDocument = {
        name: 'early step context',
        jobs: {
          build: {
            listening: listening(),
            steps: [{run: `echo ${interpolation('step.status')}`}],
          },
        },
      };

      const error = expectInvalid(document);

      expect(error.issues).toEqual([
        expect.objectContaining({
          code: 'context-unavailable-at-fill-site',
          path: ['jobs', 'build', 'steps', 0, 'run'],
          message: expect.stringContaining(
            'context "step" that is not available at step dispatch. "step" becomes available at step reporting.',
          ),
          details: expect.objectContaining({
            contextRoots: ['step'],
            unavailableRoots: ['step'],
            fillSite: 'step-dispatch',
          }),
        }),
      ]);
    });

    it('does not apply availability checks to job names', () => {
      const document: WorkflowDocument = {
        name: 'job display context',
        jobs: {
          build: {
            name: interpolation('execution.index'),
            steps: [{run: 'echo ok'}],
          },
          review: {
            name: interpolation('execution.index'),
            listening: listening(),
            steps: [{run: 'echo ok'}],
          },
        },
      };

      const model = normalizeWorkflowDocument(document);

      expect(model.jobs[0]?.name?.[0]).toMatchObject({
        kind: 'deferred',
        roots: ['execution'],
      });
      expect(model.jobs[1]?.name?.[0]).toMatchObject({
        kind: 'deferred',
        roots: ['execution'],
      });
    });

    it('does not apply availability checks to workflow-level or job-level env', () => {
      const document: WorkflowDocument = {
        name: 'shared env context',
        env: {WORKFLOW_EXECUTION: interpolation('execution.index')},
        jobs: {
          build: {
            env: {JOB_EXECUTION: interpolation('execution.index')},
            steps: [{run: 'echo ok'}],
          },
        },
      };

      const model = normalizeWorkflowDocument(document);

      expect(model.templates?.env?.WORKFLOW_EXECUTION?.[0]).toMatchObject({
        kind: 'deferred',
        roots: ['execution'],
      });
      expect(model.jobs[0]?.templates?.env?.JOB_EXECUTION?.[0]).toMatchObject({
        kind: 'deferred',
        roots: ['execution'],
      });
    });

    it('allows multi-root step fields when all roots are available by dispatch', () => {
      const document: WorkflowDocument = {
        name: 'mixed availability',
        jobs: {
          build: {
            steps: [
              {
                run: 'echo ok',
                env: {MIXED: interpolation('run.id + execution.name')},
              },
            ],
          },
        },
      };

      const model = normalizeWorkflowDocument(document);

      expect(model.jobs[0]?.steps).toHaveLength(1);
    });

    it('reports multiple unavailable roots in one message', () => {
      const document: WorkflowDocument = {
        name: 'multiple unavailable roots',
        jobs: {
          build: {
            steps: [{run: `echo ${interpolation('execution.index + step.status')}`}],
          },
        },
      };

      const error = expectInvalid(document);

      expect(error.issues).toEqual([
        expect.objectContaining({
          code: 'context-unavailable-at-fill-site',
          path: ['jobs', 'build', 'steps', 0, 'run'],
          message: expect.stringContaining(
            'context "step" that is not available at step dispatch.',
          ),
          details: expect.objectContaining({
            contextRoots: expect.arrayContaining(['execution', 'step']),
            unavailableRoots: ['step'],
            fillSite: 'step-dispatch',
          }),
        }),
      ]);
    });

    it('keeps one-shot fields valid when they reference run-scoped contexts', () => {
      const document: WorkflowDocument = {
        name: 'run context',
        jobs: {
          build: {
            steps: [
              {
                name: interpolation('job.key'),
                run: `echo ${interpolation('run.id + trigger.source')}`,
                env: {INPUT: interpolation('inputs.value')},
              },
            ],
          },
        },
      };

      const model = normalizeWorkflowDocument(document);

      expect(model.jobs[0]?.steps[0]).toMatchObject({
        kind: 'run',
        templates: {
          command: [{kind: 'literal'}, {kind: 'deferred', roots: ['run', 'trigger']}],
          name: [{kind: 'deferred', roots: ['job']}],
          env: {INPUT: [{kind: 'deferred', roots: ['inputs']}]},
        },
      });
    });

    it('allows trusted execution metadata in run commands', () => {
      const document: WorkflowDocument = {
        name: 'execution metadata',
        jobs: {
          build: {
            listening: listening(),
            steps: [{run: `echo ${interpolation('executions[0].name')}`}],
          },
        },
      };

      const model = normalizeWorkflowDocument(document);

      expect(model.jobs[0]?.steps[0]).toMatchObject({
        kind: 'run',
        templates: {
          command: [
            {kind: 'literal', value: 'echo '},
            {
              kind: 'deferred',
              expression: {language: 'cel', source: 'executions[0].name', check: 'typed'},
              roots: ['executions'],
            },
          ],
        },
      });
    });

    it('allows execution events in untrusted-capable fields', () => {
      const document: WorkflowDocument = {
        name: 'execution events allowed',
        jobs: {
          build: {
            name: `batch ${interpolation('execution.events[0].data.title')}`,
            listening: listening(),
            steps: [{provider: 'openai', prompt: interpolation('execution.events[0].data.body')}],
          },
        },
      };

      const model = normalizeWorkflowDocument(document);

      expect(model.jobs[0]?.name?.[1]).toMatchObject({
        kind: 'deferred',
        expression: {check: 'typed'},
        roots: ['execution'],
      });
      expect(model.jobs[0]?.steps[0]).toMatchObject({
        kind: 'agent',
        templates: {
          prompt: [
            {
              kind: 'deferred',
              expression: {check: 'typed'},
              roots: ['execution'],
            },
          ],
        },
      });
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
        kind: 'deferred',
        expression: {check: 'syntax'},
        roots: ['event'],
      });
      expect(model.jobs[0]?.steps[0]).toMatchObject({
        kind: 'run',
        templates: {name: [{kind: 'deferred', roots: ['event']}]},
      });
      expect(model.jobs[0]?.steps[1]).toMatchObject({
        kind: 'agent',
        templates: {prompt: [{kind: 'deferred', roots: ['inputs']}]},
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
    ] as const)('stores trusted agent %s interpolation templates', (field, step) => {
      const document: WorkflowDocument = {
        name: 'supported agent field',
        jobs: {
          fix: {
            steps: [step],
          },
        },
      };

      const model = normalizeWorkflowDocument(document);

      expect(model.jobs[0]?.steps[0]).toMatchObject({
        kind: 'agent',
        templates: {[field]: [{kind: 'deferred', roots: ['run']}]},
      });
    });

    it('skips static provider catalog validation when provider is interpolated', () => {
      const document: WorkflowDocument = {
        name: 'templated provider',
        jobs: {
          fix: {
            steps: [{provider: interpolation('run.name'), prompt: 'Fix it.'}],
          },
        },
      };

      const model = normalizeWorkflowDocument(document);

      expect(model.jobs[0]?.steps[0]).toMatchObject({
        kind: 'agent',
        templates: {provider: [{kind: 'deferred', roots: ['run']}]},
      });
    });

    it('still validates literal providers through the catalog', () => {
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
          code: 'invalid-provider',
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
        kind: 'deferred',
        expression: {check: 'typed'},
        roots: ['run', 'trigger'],
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
        kind: 'deferred',
        expression: {check: 'syntax'},
        roots: expect.arrayContaining(['run', 'event']),
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
