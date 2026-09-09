import type {WorkflowDocument} from '@shipfox/workflow-document';
import {agentValidationCatalog} from '#test/agent-validation-catalog.js';
import type {WorkflowModelValidationIssue} from './invalid-workflow-model-error.js';
import {InvalidWorkflowModelError} from './invalid-workflow-model-error.js';
import {normalizeWorkflowDocument} from './normalize-workflow-document.js';

function normalize(
  document: WorkflowDocument,
  concurrency: Parameters<typeof normalizeWorkflowDocument>[1]['concurrency'],
): {
  model: ReturnType<typeof normalizeWorkflowDocument>;
  diagnostics: WorkflowModelValidationIssue[];
} {
  const diagnostics: WorkflowModelValidationIssue[] = [];
  const model = normalizeWorkflowDocument(document, {
    agentValidationCatalog,
    concurrency,
    diagnostics,
  });
  return {model, diagnostics};
}

function interpolation(source: string): string {
  return '$'.concat('{{ ', source, ' }}');
}

function baseDocument(overrides: Partial<WorkflowDocument> = {}): WorkflowDocument {
  return {
    name: 'Concurrency workflow',
    runner: 'ubuntu-latest',
    jobs: {
      build: {steps: [{run: 'echo ok'}]},
    },
    ...overrides,
  };
}

describe('normalizeWorkflowConcurrency', () => {
  it('normalizes the group and applies workflow and false defaults', () => {
    const {model, diagnostics} = normalize(baseDocument(), {group: 'production'});

    expect(model.concurrency).toEqual({
      group: [{kind: 'literal', value: 'production'}],
      scope: 'workflow',
      cancelInProgress: false,
    });
    expect(diagnostics).toEqual([]);
  });

  it('keeps project scope and literal cancel_in_progress', () => {
    const {model, diagnostics} = normalize(baseDocument(), {
      group: 'production',
      scope: 'project',
      cancel_in_progress: true,
    });

    expect(model.concurrency).toEqual({
      group: [{kind: 'literal', value: 'production'}],
      scope: 'project',
      cancelInProgress: true,
    });
    expect(diagnostics).toEqual([]);
  });

  it('ignores document-carried concurrency outside the typed option', () => {
    const document = {...baseDocument(), concurrency: null} as WorkflowDocument & {
      readonly concurrency: null;
    };

    const {model, diagnostics} = normalize(document, undefined);

    expect(model.concurrency).toBeUndefined();
    expect(diagnostics).toEqual([]);
  });

  it('warns when the group references a root that can be null for a trigger', () => {
    const {model, diagnostics} = normalize(
      baseDocument({
        triggers: {
          manual: {source: 'manual'},
          push: {source: 'github', event: 'push'},
        },
      }),
      {group: interpolation('event.pull_request.number')},
    );

    expect(model.concurrency?.group[0]).toMatchObject({
      kind: 'deferred',
      roots: ['event'],
      fillTarget: 'run-creation',
    });
    expect(diagnostics).toEqual([
      expect.objectContaining({
        code: 'concurrency-group-root-may-be-null',
        message: expect.stringContaining('manual'),
        path: ['concurrency', 'group'],
        severity: 'warning',
        scope: 'definition',
      }),
    ]);
  });

  it('does not treat a conditional guard as proof of root availability', () => {
    const {diagnostics} = normalize(
      baseDocument({
        triggers: {
          manual: {source: 'manual', with: {pull_request_number: 10}},
          push: {source: 'github', event: 'push', with: {pull_request_number: 10}},
        },
      }),
      {
        group: interpolation(
          'event != null ? event.pull_request.number : inputs.pull_request_number',
        ),
      },
    );

    expect(diagnostics).toEqual([
      expect.objectContaining({
        code: 'concurrency-group-root-may-be-null',
        details: {roots: ['event', 'inputs'], triggers: ['manual']},
      }),
    ]);
  });

  it('does not warn when inputs are configured for every non-overridable trigger', () => {
    const {diagnostics} = normalize(
      baseDocument({
        triggers: {
          push: {source: 'github', event: 'push', with: {environment: 'production'}},
          pullRequest: {
            source: 'github',
            event: 'pull_request',
            with: {environment: 'production'},
          },
        },
      }),
      {group: interpolation('inputs.environment')},
    );

    expect(diagnostics).toEqual([]);
  });

  it('warns when manual request inputs can override configured defaults', () => {
    const {diagnostics} = normalize(
      baseDocument({
        triggers: {
          manual: {source: 'manual', with: {environment: 'production'}},
          push: {source: 'github', event: 'push', with: {environment: 'production'}},
        },
      }),
      {group: interpolation('inputs.environment')},
    );

    expect(diagnostics).toEqual([
      expect.objectContaining({
        code: 'concurrency-group-root-may-be-null',
        details: {roots: ['inputs'], triggers: ['manual']},
      }),
    ]);
  });

  it('tracks literal bracket input keys', () => {
    const {diagnostics} = normalize(
      baseDocument({
        triggers: {
          push: {source: 'github', event: 'push', with: {environment: 'production'}},
          pullRequest: {
            source: 'github',
            event: 'pull_request',
            with: {environment: 'production'},
          },
        },
      }),
      {group: interpolation('inputs["environment"]')},
    );

    expect(diagnostics).toEqual([]);
  });

  it('warns when a trigger provides an unrelated input key', () => {
    const {diagnostics} = normalize(
      baseDocument({
        triggers: {
          manual: {source: 'manual', with: {region: 'us-east-1'}},
          push: {source: 'github', event: 'push', with: {environment: 'production'}},
        },
      }),
      {group: interpolation('inputs.environment')},
    );

    expect(diagnostics).toEqual([
      expect.objectContaining({
        code: 'concurrency-group-root-may-be-null',
        details: {roots: ['inputs'], triggers: ['manual']},
      }),
    ]);
  });

  it('warns when a trigger provides an empty input map', () => {
    const {diagnostics} = normalize(
      baseDocument({
        triggers: {
          manual: {source: 'manual', with: {}},
          push: {source: 'github', event: 'push', with: {environment: 'production'}},
        },
      }),
      {group: interpolation('inputs.environment')},
    );

    expect(diagnostics).toEqual([
      expect.objectContaining({
        code: 'concurrency-group-root-may-be-null',
        details: {roots: ['inputs'], triggers: ['manual']},
      }),
    ]);
  });

  it.each([
    ['an unrelated input key', {region: 'us-east-1'}],
    ['an empty input map', {}],
  ] as const)('warns for literal bracket input access with %s', (_caseDescription, inputs) => {
    const {diagnostics} = normalize(
      baseDocument({
        triggers: {
          manual: {source: 'manual', with: inputs},
          push: {source: 'github', event: 'push', with: {environment: 'production'}},
        },
      }),
      {group: interpolation('inputs["environment"]')},
    );

    expect(diagnostics).toEqual([
      expect.objectContaining({
        code: 'concurrency-group-root-may-be-null',
        details: {roots: ['inputs'], triggers: ['manual']},
      }),
    ]);
  });

  it('warns conservatively for dynamic input keys', () => {
    const {diagnostics} = normalize(
      baseDocument({
        triggers: {
          manual: {source: 'manual', with: {field: 'not-the-dynamic-input'}},
          push: {source: 'github', event: 'push', with: {field: 'not-the-dynamic-input'}},
        },
      }),
      {group: interpolation('inputs[vars.KEY].field')},
    );

    expect(diagnostics).toEqual([
      expect.objectContaining({
        code: 'concurrency-group-root-may-be-null',
        details: {roots: ['inputs'], triggers: ['manual', 'push']},
      }),
    ]);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
  ] as const)('warns when a referenced input is explicitly %s', (_caseDescription, value) => {
    const {diagnostics} = normalize(
      baseDocument({
        triggers: {
          manual: {source: 'manual', with: {environment: value}},
          push: {source: 'github', event: 'push', with: {environment: 'production'}},
        },
      }),
      {group: interpolation('inputs.environment')},
    );

    expect(diagnostics).toEqual([
      expect.objectContaining({
        code: 'concurrency-group-root-may-be-null',
        details: {roots: ['inputs'], triggers: ['manual']},
      }),
    ]);
  });

  it('rejects concurrency for listening jobs', () => {
    let error: unknown;
    try {
      normalize(
        baseDocument({
          jobs: {
            listen: {
              listening: {
                on: [{source: 'github', event: 'pull_request'}],
                timeout: '1h',
              },
              steps: [{run: 'echo event'}],
            },
          },
        }),
        {group: 'production'},
      );
      expect.fail('Expected InvalidWorkflowModelError');
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(InvalidWorkflowModelError);
    expect((error as InvalidWorkflowModelError).issues).toEqual([
      expect.objectContaining({
        code: 'concurrency-listening-job-unsupported',
        path: ['concurrency'],
      }),
    ]);
  });

  it('rejects a non-literal cancel_in_progress value', () => {
    let error: unknown;
    try {
      normalize(baseDocument(), {
        group: 'production',
        cancel_in_progress: interpolation('inputs.cancel') as never,
      });
      expect.fail('Expected InvalidWorkflowModelError');
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(InvalidWorkflowModelError);
    expect((error as InvalidWorkflowModelError).issues).toEqual([
      expect.objectContaining({
        code: 'invalid-concurrency-cancel-in-progress',
        path: ['concurrency', 'cancel_in_progress'],
      }),
    ]);
  });
});
