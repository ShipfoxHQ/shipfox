import {
  type ActionManifestInput,
  actionManifestSchema,
  parseWorkflowDocument,
  type WorkflowDocument,
  type WorkflowDocumentStep,
} from '@shipfox/workflow-document';
import {agentValidationCatalog} from '#test/agent-validation-catalog.js';
import type {ResolvedAction, ResolvedActions} from '../entities/action-snapshot.js';
import type {IntegrationValidationContext} from '../entities/integration-context.js';
import type {
  WorkflowModel,
  WorkflowModelCompositeStep,
  WorkflowModelStep,
} from '../entities/workflow-model.js';
import {
  InvalidWorkflowModelError,
  type WorkflowModelValidationIssue,
} from './invalid-workflow-model-error.js';
import {MAX_EXPANDED_JOB_STEPS} from './normalize-composite-step.js';
import {normalizeWorkflowDocument} from './normalize-workflow-document.js';

const expr = (source: string) => `$${'{{'} ${source} }}`;
const DIGEST = `sha256:${'c'.repeat(64)}`;
const SETUP = './.shipfox/actions/setup';
const SETUP_LINE_3 = /^\.shipfox\/actions\/setup\/action\.yml:3: /;
const MIDDLE_LINE_3 = /^\.shipfox\/actions\/middle\/action\.yml:3: /;

const integrationValidationContext: IntegrationValidationContext = {
  agentToolSelectionCatalogs: new Map([
    [
      'linear',
      {
        selectors: [
          {token: 'get_issue', kind: 'standalone', sensitivity: 'read', sensitive: false},
          {token: 'save_comment', kind: 'standalone', sensitivity: 'write', sensitive: false},
        ],
      },
    ],
  ]),
  agentToolCatalogs: new Map([
    [
      'linear',
      {
        tools: [
          {
            id: 'get_issue',
            description: 'Get an issue',
            sensitivity: 'read',
            sensitive: false,
            requiredScope: 'read',
            inputSchema: {type: 'object', properties: {id: {type: 'string'}}},
          },
          {
            id: 'save_comment',
            description: 'Save a comment',
            sensitivity: 'write',
            sensitive: false,
            requiredScope: 'write',
            inputSchema: {type: 'object', properties: {body: {type: 'string'}}},
          },
        ],
      },
    ],
  ]),
  workspaceConnectionSnapshot: new Map([
    ['linear-acme', {id: 'conn-linear', provider: 'linear', capabilities: ['agent_tools']}],
  ]),
  eventCatalogs: new Map(),
  fixedEventProviders: new Set(),
};

function composite(
  uses: string,
  raw: Omit<ActionManifestInput, 'name'> & {name?: string},
  options: {registry?: ResolvedAction['registry']; files?: Record<string, string>} = {},
): [string, ResolvedAction] {
  const manifest = actionManifestSchema.parse({name: 'Composite', ...raw});
  const steps = manifest.steps ?? [];
  const manifestPath =
    options.registry === undefined ? `${uses.slice(2)}/action.yml` : `${uses}/action.yml`;
  return [
    uses,
    {
      manifest,
      digest: DIGEST,
      ...(options.registry === undefined ? {} : {registry: options.registry}),
      composite: {
        manifestPath,
        manifestFile: 'action.yml',
        // Each step sits on two lines, after `name:` and `steps:`.
        stepLocations: new Map(
          steps.map((_, index) => [index, {startLine: 3 + index * 2, endLine: 4 + index * 2}]),
        ),
        files: new Map(Object.entries(options.files ?? {})),
      },
    },
  ];
}

function javascriptAction(uses: string, raw: Omit<ActionManifestInput, 'name' | 'main'>) {
  return [
    uses,
    {
      manifest: actionManifestSchema.parse({name: 'JavaScript', main: 'index.ts', ...raw}),
      digest: DIGEST,
    },
  ] as [string, ResolvedAction];
}

function document(...steps: WorkflowDocumentStep[]): WorkflowDocument {
  return {name: 'composites', runner: 'ubuntu-latest', jobs: {build: {steps}}};
}

function normalize(
  workflow: WorkflowDocument,
  actions: readonly [string, ResolvedAction][],
  promptFiles?: ReadonlyMap<string, string>,
): WorkflowModel {
  return normalizeWorkflowDocument(workflow, {
    agentValidationCatalog,
    integrationValidationContext,
    actionManifests: new Map(actions) satisfies ResolvedActions,
    promptFiles,
  });
}

function issuesFor(
  workflow: WorkflowDocument,
  actions: readonly [string, ResolvedAction][],
): WorkflowModelValidationIssue[] {
  try {
    normalize(workflow, actions);
  } catch (error) {
    if (!(error instanceof InvalidWorkflowModelError)) throw error;
    return [...error.issues];
  }
  return [];
}

function summarize(issues: readonly WorkflowModelValidationIssue[]) {
  return issues.map((entry) => ({
    code: entry.code,
    path: entry.path.join('.'),
    at: (entry.details?.composite as {path?: string} | undefined)?.path,
  }));
}

function compositeStep(model: WorkflowModel, index = 0): WorkflowModelCompositeStep {
  const step = model.jobs[0]?.steps[index];
  if (step?.kind !== 'composite') throw new Error('Expected a composite step');
  return step;
}

describe('normalizeWorkflowDocument composite steps', () => {
  test('expands a composite into a step that holds its inner steps', () => {
    const setup = composite(SETUP, {
      inputs: {base_sha: {required: true}},
      outputs: {files: {type: 'json', value: expr('steps.changed.outputs.files')}},
      steps: [
        {run: 'mise install'},
        {
          key: 'changed',
          run: `${expr('action.path')}/changed.sh "$BASE"`,
          env: {BASE: expr('inputs.base_sha')},
          outputs: {files: 'json'},
        },
      ],
    });

    const model = normalize(
      document({
        key: 'setup',
        uses: SETUP,
        with: {base_sha: expr('event.before')},
        env: {CI: 'true'},
        working_directory: 'app',
      }),
      [setup],
    );

    const step = compositeStep(model);
    expect(step).toMatchObject({
      id: 'build-setup',
      kind: 'composite',
      composite: {
        uses: SETUP,
        origin: 'local',
        digest: DIGEST,
        name: 'Composite',
        inputs: {base_sha: {type: 'string', required: true}},
        outputs: {files: {declaration: {type: 'json', required: false}}},
        integrations: {},
      },
      with: {base_sha: expr('event.before')},
      env: {CI: 'true'},
      workingDirectory: 'app',
      outputs: {files: {type: 'json', required: false}},
    });
    expect(step.steps.map((inner) => inner.id)).toEqual([
      'build-setup.step-1',
      'build-setup.changed',
    ]);
    expect(step.steps[1]?.sourceLocation).toEqual({
      startLine: 5,
      endLine: 6,
      file: {kind: 'action', uses: SETUP, digest: DIGEST, path: 'action.yml'},
    });
    expect(step.composite.outputs.files?.value).toEqual([
      expect.objectContaining({kind: 'deferred'}),
    ]);
  });

  test('fills the inner reads of the composite inputs when a step dispatches', () => {
    const setup = composite(SETUP, {
      inputs: {base_sha: {required: true}},
      steps: [
        {run: 'echo', env: {BASE: expr('inputs.base_sha'), RUN: expr('run.id')}},
        {key: 'nested', uses: './.shipfox/actions/inner', with: {sha: expr('inputs.base_sha')}},
      ],
    });
    const inner = composite('./.shipfox/actions/inner', {
      inputs: {sha: {required: true}},
      steps: [{run: 'echo'}],
    });

    const step = compositeStep(
      normalize(document({uses: SETUP, with: {base_sha: expr('inputs.sha')}}), [setup, inner]),
    );

    expect(step.templates?.with).toEqual({
      base_sha: [expect.objectContaining({roots: ['inputs'], fillTarget: 'run-creation'})],
    });
    const [run, nested] = step.steps;
    expect(run?.kind === 'run' ? run.templates?.env : undefined).toEqual({
      BASE: [expect.objectContaining({roots: ['inputs'], fillTarget: 'step-dispatch'})],
      RUN: [expect.objectContaining({roots: ['run'], fillTarget: 'run-creation'})],
    });
    expect(nested?.kind === 'composite' ? nested.templates?.with : undefined).toEqual({
      sha: [expect.objectContaining({roots: ['inputs'], fillTarget: 'step-dispatch'})],
    });
  });

  test('scopes the ids of nested composites under each use', () => {
    const inner = composite('./.shipfox/actions/inner', {steps: [{key: 'lint', run: 'lint'}]});
    const outer = composite(SETUP, {
      steps: [{key: 'first', uses: './.shipfox/actions/inner'}],
    });

    const model = normalize(document({key: 'a', uses: SETUP}, {key: 'b', uses: SETUP}), [
      outer,
      inner,
    ]);

    const nested = (index: number) =>
      (compositeStep(model, index).steps[0] as WorkflowModelCompositeStep).steps[0]?.id;
    expect(nested(0)).toBe('build-a.first.lint');
    expect(nested(1)).toBe('build-b.first.lint');
  });

  test('types inputs from the manifest and keeps the caller steps out of scope', () => {
    const setup = composite(SETUP, {
      inputs: {base_sha: {required: true}},
      steps: [
        {run: `echo ${expr('inputs.base')}`},
        {run: `echo ${expr('steps.before.outputs.value')}`},
      ],
    });

    const issues = issuesFor(
      document(
        {key: 'before', run: 'echo hi', outputs: {value: {type: 'string'}}},
        {key: 'setup', uses: SETUP, with: {base_sha: 'abc'}},
      ),
      [setup],
    );

    expect(summarize(issues)).toEqual([
      {code: 'invalid-interpolation-expression', path: 'jobs.build.steps.1', at: 'steps.0.run'},
      {code: 'invalid-interpolation-expression', path: 'jobs.build.steps.1', at: 'steps.1.run'},
    ]);
    expect(issues[0]?.message).toMatch(SETUP_LINE_3);
  });

  test('lets inner steps read earlier inner steps and run-wide roots', () => {
    const setup = composite(SETUP, {
      steps: [
        {key: 'first', run: 'echo hi', outputs: {value: 'string'}},
        {
          run: `echo ${expr('steps.first.outputs.value')} ${expr('vars.REGION')} ${expr('event.ref')}`,
        },
      ],
    });

    expect(() => normalize(document({uses: SETUP}), [setup])).not.toThrow();
  });

  test('types inner if conditions with the composite inputs and action', () => {
    const setup = composite(SETUP, {
      inputs: {lint: {type: 'boolean'}, token: {secret: true}},
      steps: [
        {run: 'lint', if: expr('inputs.lint')},
        {run: 'x', if: expr("action.path != ''")},
        {run: 'typo', if: expr('inputs.tpyo')},
        {run: 'secret', if: expr("inputs.token != ''")},
      ],
    });

    const issues = issuesFor(document({uses: SETUP, with: {lint: true}}), [setup]);

    expect(summarize(issues)).toEqual([
      {code: 'invalid-step-if', path: 'jobs.build.steps.0', at: 'steps.2.if'},
      {code: 'invalid-step-if', path: 'jobs.build.steps.0', at: 'steps.3.if'},
    ]);
  });

  test('reports an unresolved action.path action once', () => {
    const setup = composite(SETUP, {steps: [{uses: `${expr('action.path')}/missing`}]});

    const issues = issuesFor(document({uses: SETUP}), [setup]);

    expect(summarize(issues)).toEqual([
      {code: 'action-not-resolved', path: 'jobs.build.steps.0', at: 'steps.0.uses'},
    ]);
  });

  test('rejects secrets inside a composite', () => {
    const setup = composite(SETUP, {
      steps: [{run: 'npm publish', env: {TOKEN: expr('secrets.NPM_TOKEN')}}],
    });

    const issues = issuesFor(document({uses: SETUP}), [setup]);

    expect(summarize(issues)).toEqual([
      {code: 'composite-secrets-forbidden', path: 'jobs.build.steps.0', at: 'steps.0.env.TOKEN'},
    ]);
  });

  test('rejects continue_on_error on the step that uses a composite', () => {
    const setup = composite(SETUP, {steps: [{run: 'npm ci', continue_on_error: true}]});

    const issues = issuesFor(document({uses: SETUP, continue_on_error: true}), [setup]);

    expect(summarize(issues)).toEqual([
      {
        code: 'composite-continue-on-error-unsupported',
        path: 'jobs.build.steps.0.continue_on_error',
        at: undefined,
      },
    ]);
  });

  test('rejects background on the step that uses a composite', () => {
    const setup = composite(SETUP, {steps: [{run: 'npm ci'}]});

    const issues = issuesFor(document({key: 'setup', uses: SETUP, background: true}), [setup]);

    expect(summarize(issues)).toEqual([
      {
        code: 'composite-background-unsupported',
        path: 'jobs.build.steps.0.background',
        at: undefined,
      },
    ]);
  });

  test('rejects a composite action as a step of a parallel block', () => {
    const setup = composite(SETUP, {steps: [{run: 'npm ci'}]});
    const workflow = parseWorkflowDocument(
      {
        name: 'composites',
        runner: 'ubuntu-latest',
        jobs: {build: {steps: [{parallel: [{run: 'echo'}, {uses: SETUP}]}]}},
      },
      {actions: true},
    );

    const issues = issuesFor(workflow, [setup]);

    expect(summarize(issues)).toEqual([
      {
        code: 'composite-background-unsupported',
        path: 'jobs.build.steps.0.parallel.1',
        at: undefined,
      },
    ]);
    expect(issues[0]?.message).toBe('A composite action cannot be a step of a `parallel` block.');
  });

  test('carries continue_on_error on a step inside a composite', () => {
    const setup = composite(SETUP, {steps: [{run: 'npm ci', continue_on_error: true}]});

    const step = compositeStep(normalize(document({uses: SETUP}), [setup]));

    expect(step.steps[0]?.continueOnError).toBe(true);
  });

  test('rejects the action root outside a composite', () => {
    const issues = issuesFor(document({run: `${expr('action.path')}/x.sh`}), []);

    expect(summarize(issues)).toEqual([
      {code: 'unknown-interpolation-context', path: 'jobs.build.steps.0.run', at: undefined},
    ]);
  });

  test('rewrites secret inputs to the caller reference through two levels', () => {
    const publish = composite('./.shipfox/actions/publish', {
      inputs: {token: {secret: true, required: true}},
      steps: [{key: 'npm', run: 'npm publish', env: {NODE_AUTH_TOKEN: expr('inputs.token')}}],
    });
    const release = composite(SETUP, {
      inputs: {npm_token: {secret: true, required: true}},
      steps: [
        {
          key: 'publish',
          uses: './.shipfox/actions/publish',
          with: {token: expr('inputs.npm_token')},
        },
      ],
    });

    const model = normalize(
      document({key: 'release', uses: SETUP, with: {npm_token: expr('secrets.NPM_TOKEN')}}),
      [release, publish],
    );

    const outer = compositeStep(model);
    expect(outer.with).toBeUndefined();
    expect(outer.composite.inputs.npm_token).toEqual({
      type: 'string',
      required: true,
      secret: true,
    });
    const run = (outer.steps[0] as WorkflowModelCompositeStep).steps[0];
    expect(run).toMatchObject({kind: 'run', env: {NODE_AUTH_TOKEN: expr('secrets.NPM_TOKEN')}});
  });

  test('rejects a secret input given anything but a secret reference', () => {
    const publish = composite(SETUP, {
      inputs: {token: {secret: true, required: true}, name: {}},
      steps: [{run: 'npm publish', env: {TOKEN: expr('inputs.token')}}],
    });

    const issues = issuesFor(
      document({uses: SETUP, with: {token: 'plain', name: expr('secrets.NAME')}}),
      [publish],
    );

    expect(summarize(issues)).toEqual([
      {code: 'action-secret-input-invalid', path: 'jobs.build.steps.0.with.token', at: undefined},
      {code: 'action-secret-input-invalid', path: 'jobs.build.steps.0.with.name', at: undefined},
    ]);
  });

  test('keeps a secret input out of server fields', () => {
    const review = composite(SETUP, {
      inputs: {token: {secret: true, required: true}},
      steps: [{prompt: `Use ${expr('inputs.token')}`}],
    });

    const issues = issuesFor(document({uses: SETUP, with: {token: expr('secrets.TOKEN')}}), [
      review,
    ]);

    expect(summarize(issues)).toEqual([
      {code: 'runner-context-in-field', path: 'jobs.build.steps.0', at: 'steps.0.prompt'},
    ]);
  });

  test('binds a tool step alias to the caller connection', () => {
    const tracker = composite(SETUP, {
      integrations: {tracker: {provider: 'linear', include: ['get_issue']}},
      steps: [{key: 'issue', tool: 'get_issue', connection: 'tracker', with: {id: 'ENG-1'}}],
    });

    const model = normalize(document({uses: SETUP, connections: {tracker: 'linear-acme'}}), [
      tracker,
    ]);

    const step = compositeStep(model);
    expect(step.composite.integrations).toEqual({
      tracker: {
        provider: 'linear',
        connection: 'linear-acme',
        include: ['get_issue'],
        allowWrite: false,
      },
    });
    expect(step.steps[0]).toMatchObject({kind: 'tool', connection: 'linear-acme'});
  });

  test('keeps inner tool and agent steps inside the alias', () => {
    const tracker = composite(SETUP, {
      integrations: {tracker: {provider: 'linear', include: ['get_issue']}},
      steps: [
        {tool: 'save_comment', connection: 'tracker', with: {body: 'hi'}},
        {
          prompt: 'Triage.',
          integrations: [{connection: 'tracker', include: ['save_comment'], allow_write: true}],
        },
        {tool: 'get_issue', connection: 'other', with: {id: 'ENG-1'}},
      ],
    });

    const issues = issuesFor(document({uses: SETUP, connections: {tracker: 'linear-acme'}}), [
      tracker,
    ]);

    expect(summarize(issues)).toEqual(
      expect.arrayContaining([
        {code: 'action-integration-exceeds-alias', path: 'jobs.build.steps.0', at: 'steps.0.tool'},
        {
          code: 'action-integration-exceeds-alias',
          path: 'jobs.build.steps.0',
          at: 'steps.1.integrations.0.include',
        },
        {
          code: 'action-integration-exceeds-alias',
          path: 'jobs.build.steps.0',
          at: 'steps.1.integrations.0.allow_write',
        },
        {code: 'action-connection-unknown', path: 'jobs.build.steps.0', at: 'steps.2.connection'},
      ]),
    );
  });

  test('needs allow_write on the alias for a write tool', () => {
    const tracker = composite(SETUP, {
      integrations: {tracker: {provider: 'linear', include: ['save_comment']}},
      steps: [{tool: 'save_comment', connection: 'tracker', with: {body: 'hi'}}],
    });

    const issues = issuesFor(document({uses: SETUP, connections: {tracker: 'linear-acme'}}), [
      tracker,
    ]);

    // The manifest grant is checked against the catalog too.
    expect(summarize(issues)).toEqual([
      {code: 'integration-write-not-allowed', path: 'jobs.build.steps.0.uses', at: undefined},
      {code: 'integration-write-not-allowed', path: 'jobs.build.steps.0', at: 'steps.0.tool'},
    ]);
  });

  test('rejects a write grant nested under a read-only alias, at every level', () => {
    const comment = javascriptAction('./.shipfox/actions/comment', {
      integrations: {linear: {provider: 'linear', include: ['get_issue'], allow_write: true}},
    });
    const middle = (allowWrite: boolean) =>
      composite('./.shipfox/actions/middle', {
        integrations: {
          tracker: {provider: 'linear', include: ['get_issue'], allow_write: allowWrite},
        },
        steps: [{uses: './.shipfox/actions/comment', connections: {linear: 'tracker'}}],
      });
    const top = composite(SETUP, {
      integrations: {issues: {provider: 'linear', include: ['get_issue']}},
      steps: [{uses: './.shipfox/actions/middle', connections: {tracker: 'issues'}}],
    });
    const workflow = document({uses: SETUP, connections: {issues: 'linear-acme'}});

    const readOnlyMiddle = issuesFor(workflow, [top, middle(false), comment]);
    const writeMiddle = issuesFor(workflow, [top, middle(true), comment]);

    expect(summarize(readOnlyMiddle)).toEqual([
      {
        code: 'action-integration-exceeds-alias',
        path: 'jobs.build.steps.0',
        at: 'steps.0.connections.linear',
      },
    ]);
    expect(readOnlyMiddle[0]?.message).toMatch(MIDDLE_LINE_3);
    expect(summarize(writeMiddle)).toEqual([
      {
        code: 'action-integration-exceeds-alias',
        path: 'jobs.build.steps.0',
        at: 'steps.0.connections.tracker',
      },
    ]);
    expect(writeMiddle[0]?.message).toMatch(SETUP_LINE_3);
  });

  test('accepts a nested grant that fits, family selectors included', () => {
    const reader = javascriptAction('./.shipfox/actions/reader', {
      integrations: {linear: {provider: 'linear', include: ['issues.get']}},
    });
    const top = composite(SETUP, {
      integrations: {issues: {provider: 'linear', include: ['issues']}},
      steps: [{uses: './.shipfox/actions/reader', connections: {linear: 'issues'}}],
    });

    const issues = issuesFor(document({uses: SETUP, connections: {issues: 'linear-acme'}}), [
      top,
      reader,
    ]);

    expect(issues.filter((entry) => entry.code === 'action-integration-exceeds-alias')).toEqual([]);
  });

  test('scopes inner agent sessions unless the key is a whole input', () => {
    const review = composite(SETUP, {
      inputs: {session: {required: true}},
      steps: [
        {prompt: 'Review.', session: 'review'},
        {prompt: 'Continue.', session: expr('inputs.session')},
      ],
    });

    const model = normalize(document({key: 'review', uses: SETUP, with: {session: 'shared'}}), [
      review,
    ]);

    const [scoped, picked] = compositeStep(model).steps as WorkflowModelStep[];
    expect(scoped).toMatchObject({session: {scope: 'build-review'}});
    expect(picked?.kind === 'agent' && picked.session?.scope).toBeUndefined();
  });

  test('checks inner restart_from against inner siblings only', () => {
    const setup = composite(SETUP, {
      steps: [
        {key: 'build', run: 'make'},
        {run: 'make test', gate: {on_failure: {restart_from: 'build'}}},
        {run: 'make lint', gate: {on_failure: {restart_from: 'before'}}},
      ],
    });

    const issues = issuesFor(document({key: 'before', run: 'true'}, {uses: SETUP}), [setup]);

    expect(summarize(issues)).toEqual([
      {
        code: 'invalid-step-gate-restart-from',
        path: 'jobs.build.steps.1',
        at: 'steps.2.gate.on_failure',
      },
    ]);
  });

  test('reads action.path prompt files from the composite files', () => {
    const review = composite(
      SETUP,
      {
        steps: [
          {prompt: [{file: `${expr('action.path')}/prompts/review.md`}, {file: './REVIEW.md'}]},
        ],
      },
      {files: {'prompts/review.md': 'Review the change.'}},
    );

    const model = normalize(
      document({uses: SETUP}),
      [review],
      new Map([['./REVIEW.md', 'Follow the guide.']]),
    );

    expect(compositeStep(model).steps[0]).toMatchObject({
      kind: 'agent',
      prompt: 'Review the change.\n\nFollow the guide.',
    });
  });

  test('reports a missing action.path prompt file in the composite', () => {
    const review = composite(SETUP, {
      steps: [{prompt: [{file: `${expr('action.path')}/prompts/missing.md`}]}],
    });

    const issues = issuesFor(document({uses: SETUP}), [review]);

    expect(summarize(issues)).toEqual([
      {code: 'prompt-file-invalid', path: 'jobs.build.steps.0', at: 'steps.0.prompt.0'},
    ]);
  });

  test('reports the issues of several uses of one composite once', () => {
    const setup = composite(SETUP, {steps: [{run: `echo ${expr('inputs.missing')}`}]});

    const issues = issuesFor(document({uses: SETUP}, {uses: SETUP}), [setup]);

    expect(summarize(issues)).toEqual([
      {code: 'invalid-interpolation-expression', path: 'jobs.build.steps.0', at: 'steps.0.run'},
    ]);
  });

  test('checks output values against the inner steps and inputs', () => {
    const setup = composite(SETUP, {
      inputs: {base: {}},
      outputs: {
        ok: {value: `${expr('inputs.base')}-${expr('steps.first.outputs.value')}`},
        bad: {value: expr('steps.missing.outputs.value')},
      },
      steps: [{key: 'first', run: 'echo hi', outputs: {value: 'string'}}],
    });

    const issues = issuesFor(document({uses: SETUP}), [setup]);

    expect(summarize(issues)).toEqual([
      {
        code: 'invalid-interpolation-expression',
        path: 'jobs.build.steps.0',
        at: 'outputs.bad.value',
      },
    ]);
  });

  test('lets later steps and job exports read the composite outputs', () => {
    const setup = composite(SETUP, {
      outputs: {files: {type: 'json', value: expr('steps.first.outputs.files')}},
      steps: [{key: 'first', run: 'echo []', outputs: {files: 'json'}}],
    });

    const model = normalize(
      document(
        {key: 'setup', uses: SETUP, export: ['files']},
        {run: `echo ${expr('steps.setup.outputs.files')}`},
      ),
      [setup],
    );

    expect(model.jobs[0]?.exportedOutputs).toEqual({files: {stepKey: 'setup', output: 'files'}});
  });

  test('lets an optional secret input stay optional through a nested composite', () => {
    const publish = composite('./.shipfox/actions/publish', {
      inputs: {token: {secret: true}},
      steps: [{run: 'npm publish', env: {TOKEN: expr('inputs.token')}}],
    });
    const release = composite(SETUP, {
      inputs: {npm_token: {secret: true}},
      steps: [{uses: './.shipfox/actions/publish', with: {token: expr('inputs.npm_token')}}],
    });

    const model = normalize(document({uses: SETUP}), [release, publish]);

    const nested = compositeStep(model).steps[0] as WorkflowModelCompositeStep;
    expect(nested.with).toBeUndefined();
    expect(nested.steps[0]).toMatchObject({kind: 'run', env: {TOKEN: ''}});
  });

  test('still requires a required nested secret input the caller left out', () => {
    const publish = composite('./.shipfox/actions/publish', {
      inputs: {token: {secret: true, required: true}},
      steps: [{run: 'npm publish', env: {TOKEN: expr('inputs.token')}}],
    });
    const release = composite(SETUP, {
      inputs: {npm_token: {secret: true}},
      steps: [{uses: './.shipfox/actions/publish', with: {token: expr('inputs.npm_token')}}],
    });

    const issues = issuesFor(document({uses: SETUP}), [release, publish]);

    expect(summarize(issues)).toEqual([
      {code: 'action-input-missing', path: 'jobs.build.steps.0', at: 'steps.0.with.token'},
    ]);
  });

  test('rejects a fan-out above the limit before expanding it', () => {
    const leaf = composite('./.shipfox/actions/leaf', {
      steps: Array.from({length: 10}, (_, index) => ({run: `echo ${index}`})),
    });
    const wide = composite(SETUP, {
      steps: Array.from({length: 25}, () => ({uses: './.shipfox/actions/leaf'})),
    });

    const model = () => normalize(document({uses: SETUP}), [wide, leaf]);

    expect(model).toThrow(InvalidWorkflowModelError);
    expect(summarize(issuesFor(document({uses: SETUP}), [wide, leaf]))).toEqual([
      {code: 'job-steps-too-many', path: 'jobs.build.steps', at: undefined},
    ]);
  });

  test(`rejects a job above ${MAX_EXPANDED_JOB_STEPS} expanded steps`, () => {
    const setup = composite(SETUP, {
      steps: Array.from({length: MAX_EXPANDED_JOB_STEPS}, (_, index) => ({run: `echo ${index}`})),
    });

    const issues = issuesFor(document({uses: SETUP}), [setup]);

    expect(summarize(issues)).toEqual([
      {code: 'job-steps-too-many', path: 'jobs.build.steps', at: undefined},
    ]);
  });
});
