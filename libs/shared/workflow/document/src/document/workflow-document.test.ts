import {workflowDocumentSchema} from './workflow-document.js';

describe('workflowDocumentSchema', () => {
  it('accepts a valid minimal workflow document', () => {
    const workflowDocument = {
      name: 'simple build',
      jobs: {
        build: {
          steps: [{run: 'npm run build'}],
        },
      },
    };

    const result = workflowDocumentSchema.safeParse(workflowDocument);

    expect(result.success).toBe(true);
  });

  it.each([
    [
      'top-level string runner',
      {name: 'simple build', runner: 'ubuntu-latest', jobs: {build: {steps: [{run: 'npm test'}]}}},
    ],
    [
      'top-level runner array',
      {
        name: 'simple build',
        runner: ['ubuntu-latest', 'node-22'],
        jobs: {build: {steps: [{run: 'npm test'}]}},
      },
    ],
    [
      'job string runner',
      {
        name: 'simple build',
        jobs: {build: {runner: 'ubuntu-latest', steps: [{run: 'npm test'}]}},
      },
    ],
    [
      'job runner array',
      {
        name: 'simple build',
        jobs: {build: {runner: ['ubuntu-latest', 'node-22'], steps: [{run: 'npm test'}]}},
      },
    ],
    [
      'string dependency',
      {name: 'simple build', jobs: {build: {needs: 'install', steps: [{run: 'npm test'}]}}},
    ],
    [
      'dependency array',
      {
        name: 'simple build',
        jobs: {build: {needs: ['install', 'lint'], steps: [{run: 'npm test'}]}},
      },
    ],
  ])('accepts %s shorthand', (_label, workflowDocument) => {
    const result = workflowDocumentSchema.safeParse(workflowDocument);

    expect(result.success).toBe(true);
  });

  it.each([
    [
      'checkout contents write',
      {
        checkout: {
          permissions: {
            contents: 'write',
          },
        },
      },
    ],
    ['checkout persist credentials false', {checkout: {'persist-credentials': false}}],
    ['empty checkout', {checkout: {}}],
    ['omitted checkout', {}],
  ])('accepts %s', (_label, jobOverride) => {
    const result = workflowDocumentSchema.safeParse({
      name: 'simple build',
      jobs: {
        build: {
          ...jobOverride,
          steps: [{run: 'npm test'}],
        },
      },
    });

    expect(result.success).toBe(true);
  });

  it('keeps trigger filters as strings', () => {
    const workflowDocument = {
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
          steps: [{run: 'npm run build'}],
        },
      },
    };

    const result = workflowDocumentSchema.parse(workflowDocument);

    expect(result.triggers?.main_push?.filter).toBe('event.ref == "refs/heads/main"');
  });

  it('accepts listening job configuration under a listening block', () => {
    const workflowDocument = {
      name: 'listen for reviews',
      jobs: {
        review: {
          listening: {
            on: [{source: 'github', event: 'pull_request_review'}],
            until: [{source: 'github', event: 'pull_request'}],
            timeout: '30d',
            max_executions: 3,
            batch: {debounce: '5s', max_size: 10, max_wait: '1h'},
            on_resolve: 'cancel',
          },
          steps: [{prompt: 'Review'}],
        },
      },
    };

    const result = workflowDocumentSchema.safeParse(workflowDocument);

    expect(result.success).toBe(true);
  });

  it('rejects an empty listening batch block', () => {
    const result = workflowDocumentSchema.safeParse({
      name: 'listen for reviews',
      jobs: {
        review: {
          listening: {
            on: [{source: 'github', event: 'pull_request_review'}],
            batch: {},
          },
          steps: [{prompt: 'Review'}],
        },
      },
    });

    const issue = result.success
      ? undefined
      : result.error.issues.find(
          (candidate) => candidate.path.join('.') === 'jobs.review.listening.batch',
        );
    expect(issue?.message).toBe('Expected debounce, max_size, or max_wait');
  });

  it('rejects flat listening fields on a job', () => {
    const result = workflowDocumentSchema.safeParse({
      name: 'listen for reviews',
      jobs: {
        review: {
          on: [{source: 'github', event: 'pull_request_review'}],
          steps: [{prompt: 'Review'}],
        },
      },
    });

    const issue = result.success
      ? undefined
      : result.error.issues.find((candidate) => candidate.path.join('.') === 'jobs.review');
    expect(issue?.message).toContain('Unrecognized key');
    expect(issue?.message).toContain('on');
  });

  it('accepts env maps at workflow, job, and run-step scope', () => {
    const workflowDocument = {
      name: 'env build',
      env: {NODE_ENV: 'test', PORT: 3000, CI: true},
      jobs: {
        build: {
          env: {JOB_SCOPE: 'build'},
          steps: [{run: 'npm test', env: {STEP_SCOPE: 'test'}}],
        },
      },
    };

    const result = workflowDocumentSchema.safeParse(workflowDocument);

    expect(result.success).toBe(true);
  });

  it.each([
    ['has a key that starts with a digit', {env: {'1PORT': '3000'}}],
    ['has a key containing a dash', {env: {'NODE-ENV': 'test'}}],
    ['has a key containing a dot', {env: {'node.env': 'test'}}],
    ['has a string value containing a null byte', {env: {NODE_ENV: 'test\u0000prod'}}],
    ['has a null value', {env: {NODE_ENV: null}}],
    ['has an object value', {env: {NODE_ENV: {value: 'test'}}}],
  ])('rejects env that %s', (_label, override) => {
    const result = workflowDocumentSchema.safeParse({
      name: 'env build',
      jobs: {
        build: {
          steps: [{run: 'npm test', ...override}],
        },
      },
    });

    expect(result.success).toBe(false);
  });

  it('reports a clear message for env on an agent step', () => {
    const result = workflowDocumentSchema.safeParse({
      name: 'agent build',
      jobs: {
        fix: {
          steps: [{model: 'claude-opus-4-8', prompt: 'Fix it.', env: {NODE_ENV: 'test'}}],
        },
      },
    });

    const envIssue = result.success
      ? undefined
      : result.error.issues.find((issue) => issue.path.includes('env'));
    expect(envIssue?.message).toBe('"env" is supported only on run steps.');
  });

  it('accepts a step gate with success_if and on_failure', () => {
    const workflowDocument = {
      name: 'review loop',
      jobs: {
        review: {
          steps: [
            {name: 'producer', run: 'npm run build'},
            {
              name: 'reviewer',
              run: 'npm run review',
              gate: {
                success_if: 'step.output.pass == true',
                on_failure: {
                  restart_from: 'producer',
                  output: 'Review failed',
                },
              },
            },
          ],
        },
      },
    };

    const result = workflowDocumentSchema.safeParse(workflowDocument);

    expect(result.success).toBe(true);
  });

  it.each([
    ['missing required top-level fields', {}],
    ['empty jobs map', {name: 'simple build', jobs: {}}],
    [
      'empty triggers map',
      {name: 'simple build', triggers: {}, jobs: {build: {steps: [{run: 'npm test'}]}}},
    ],
    ['empty steps array', {name: 'simple build', jobs: {build: {steps: []}}}],
    [
      'unsupported top-level on field',
      {name: 'simple build', on: 'push', jobs: {build: {steps: [{run: 'npm test'}]}}},
    ],
    [
      'unsupported trigger on field',
      {
        name: 'simple build',
        triggers: {github: {source: 'github', event: 'push', on: 'pull_request'}},
        jobs: {build: {steps: [{run: 'npm test'}]}},
      },
    ],
    [
      'trigger without event',
      {
        name: 'simple build',
        triggers: {github: {source: 'github'}},
        jobs: {build: {steps: [{run: 'npm test'}]}},
      },
    ],
    [
      'unknown fields',
      {name: 'simple build', jobs: {build: {steps: [{run: 'npm test', shell: 'bash'}]}}},
    ],
    ['empty gate', {name: 'simple build', jobs: {build: {steps: [{run: 'npm test', gate: {}}]}}}],
    [
      'gate unknown field',
      {
        name: 'simple build',
        jobs: {build: {steps: [{run: 'npm test', gate: {if: 'exit_code == 0'}}]}},
      },
    ],
    [
      'gate on_failure without restart_from',
      {
        name: 'simple build',
        jobs: {build: {steps: [{run: 'npm test', gate: {on_failure: {}}}]}},
      },
    ],
    [
      'unknown checkout field',
      {
        name: 'simple build',
        jobs: {build: {checkout: {token: true}, steps: [{run: 'npm test'}]}},
      },
    ],
    [
      'unknown checkout permissions field',
      {
        name: 'simple build',
        jobs: {
          build: {
            checkout: {permissions: {pull_requests: 'write'}},
            steps: [{run: 'npm test'}],
          },
        },
      },
    ],
    [
      'invalid checkout contents',
      {
        name: 'simple build',
        jobs: {
          build: {
            checkout: {permissions: {contents: 'admin'}},
            steps: [{run: 'npm test'}],
          },
        },
      },
    ],
    [
      'non-boolean checkout persist credentials',
      {
        name: 'simple build',
        jobs: {
          build: {
            checkout: {'persist-credentials': 'false'},
            steps: [{run: 'npm test'}],
          },
        },
      },
    ],
  ])('rejects %s', (_label, workflowDocument) => {
    const result = workflowDocumentSchema.safeParse(workflowDocument);

    expect(result.success).toBe(false);
  });

  it.each([
    ['prompt-only agent step', {prompt: 'Fix the failing tests.'}],
    ['inline agent step', {model: 'claude-opus-4-8', prompt: 'Fix the failing tests.'}],
    ['agent step with thinking', {model: 'claude-opus-4-8', prompt: 'Fix it.', thinking: 'low'}],
    ['agent step with provider', {model: 'gpt-5.5-pro', prompt: 'Fix it.', provider: 'openai'}],
    ['agent step with provider only', {provider: 'openai', prompt: 'Fix it.'}],
    ['agent step with name', {name: 'fix', model: 'claude-opus-4-8', prompt: 'Fix it.'}],
    [
      'agent step with gate',
      {model: 'claude-opus-4-8', prompt: 'Fix it.', gate: {success_if: 'exit_code == 0'}},
    ],
    ['custom-model-provider model string', {model: 'openrouter/anthropic/claude', prompt: 'Hi.'}],
  ])('accepts %s', (_label, step) => {
    const result = workflowDocumentSchema.safeParse({
      name: 'agent build',
      jobs: {fix: {steps: [step]}},
    });

    expect(result.success).toBe(true);
  });

  it.each([
    ['agent step missing prompt', {model: 'claude-opus-4-8'}],
    ['prompt on a run step', {run: 'npm test', prompt: 'Fix.'}],
    ['model on a run step', {run: 'npm test', model: 'claude-opus-4-8'}],
    ['neither run nor agent', {name: 'noop'}],
    ['reserved agent keyword', {agent: 'producer', model: 'claude-opus-4-8', prompt: 'Fix.'}],
    ['thinking on a run step', {run: 'npm test', thinking: 'high'}],
    ['provider on a run step', {run: 'npm test', provider: 'openai'}],
    ['unknown thinking value', {model: 'claude-opus-4-8', prompt: 'Fix.', thinking: 'ultra'}],
    ['empty model string', {model: '', prompt: 'Fix.'}],
    ['empty provider string', {model: 'gpt-5.5-pro', prompt: 'Fix.', provider: ''}],
  ])('rejects %s', (_label, step) => {
    const result = workflowDocumentSchema.safeParse({
      name: 'agent build',
      jobs: {fix: {steps: [step]}},
    });

    expect(result.success).toBe(false);
  });

  it('reports a clear message for the reserved agent keyword', () => {
    const result = workflowDocumentSchema.safeParse({
      name: 'agent build',
      jobs: {fix: {steps: [{agent: 'producer'}]}},
    });

    const messages = result.success ? [] : result.error.issues.map((issue) => issue.message);
    expect(messages.some((message) => message.includes('reserved'))).toBe(true);
  });

  it('reports a missing-prompt message on the prompt path', () => {
    const result = workflowDocumentSchema.safeParse({
      name: 'agent build',
      jobs: {fix: {steps: [{model: 'claude-opus-4-8'}]}},
    });

    const promptIssue = result.success
      ? undefined
      : result.error.issues.find((issue) => issue.path.includes('prompt'));
    expect(promptIssue?.message).toContain('prompt');
  });
});
