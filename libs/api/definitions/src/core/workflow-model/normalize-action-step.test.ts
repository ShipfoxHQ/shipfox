import {
  type ActionManifest,
  type ActionManifestInput,
  actionManifestSchema,
  type WorkflowDocument,
  type WorkflowDocumentStep,
} from '@shipfox/workflow-document';
import {agentValidationCatalog} from '#test/agent-validation-catalog.js';
import type {ResolvedActions} from '../entities/action-snapshot.js';
import type {IntegrationValidationContext} from '../entities/integration-context.js';
import type {WorkflowModel} from '../entities/workflow-model.js';
import {InvalidWorkflowModelError} from './invalid-workflow-model-error.js';
import {normalizeWorkflowDocument} from './normalize-workflow-document.js';

const USES = './.shipfox/actions/slack-thread';
const DIGEST = `sha256:${'a'.repeat(64)}`;

const integrationValidationContext: IntegrationValidationContext = {
  agentToolSelectionCatalogs: new Map([
    [
      'slack',
      {
        selectors: [
          {token: 'read_thread', kind: 'standalone', sensitivity: 'read', sensitive: false},
          {token: 'post_message', kind: 'standalone', sensitivity: 'write', sensitive: false},
          {token: 'channels', kind: 'family', sensitivity: 'read', sensitive: false},
          {token: 'channels.list', kind: 'method', sensitivity: 'read', sensitive: false},
        ],
      },
    ],
    ['github', {selectors: []}],
  ]),
  agentToolCatalogs: new Map(),
  workspaceConnectionSnapshot: new Map([
    ['team-slack', {id: 'conn-slack', provider: 'slack', capabilities: ['agent_tools']}],
    ['slack-no-tools', {id: 'conn-slack-2', provider: 'slack', capabilities: []}],
    [
      'github-main',
      {id: 'conn-github', provider: 'github', capabilities: ['source_control', 'agent_tools']},
    ],
  ]),
  eventCatalogs: new Map(),
  fixedEventProviders: new Set(),
};

function manifest(overrides: Partial<ActionManifestInput> = {}): ActionManifest {
  return actionManifestSchema.parse({
    name: 'Slack thread to Markdown',
    main: 'index.ts',
    inputs: {
      channel_id: {required: true},
      thread_ts: {required: true},
      token: {},
      destination: {default: 'context/slack-thread.md'},
      limit: {type: 'number', default: 100},
      filter: {
        type: 'json',
        schema: {type: 'object', properties: {user: {type: 'string'}}, required: ['user']},
      },
    },
    outputs: {
      path: {required: true},
      message_count: {type: 'number', required: true},
      complete: {type: 'boolean'},
    },
    integrations: {slack: {provider: 'slack', include: ['read_thread', 'read_thread']}},
    ...overrides,
  });
}

function actions(value: ActionManifest = manifest()): ResolvedActions {
  return new Map([[USES, {manifest: value, digest: DIGEST}]]);
}

function actionStep(overrides: Partial<WorkflowDocumentStep> = {}): WorkflowDocumentStep {
  return {
    key: 'thread',
    uses: USES,
    connections: {slack: 'team-slack'},
    with: {channel_id: 'C0123', thread_ts: '1727000000.1234'},
    ...overrides,
  };
}

function document(...steps: WorkflowDocumentStep[]): WorkflowDocument {
  return {name: 'actions', runner: 'ubuntu-latest', jobs: {investigate: {steps}}};
}

function normalize(
  workflow: WorkflowDocument,
  actionManifests: ResolvedActions = actions(),
): WorkflowModel {
  return normalizeWorkflowDocument(workflow, {
    agentValidationCatalog,
    integrationValidationContext,
    actionManifests,
  });
}

function issuesFor(
  workflow: WorkflowDocument,
  actionManifests?: ResolvedActions,
): {code: string; path: string}[] {
  try {
    normalize(workflow, actionManifests);
  } catch (error) {
    if (!(error instanceof InvalidWorkflowModelError)) throw error;
    return error.issues.map((entry) => ({code: entry.code, path: entry.path.join('.')}));
  }
  return [];
}

const stepPath = 'jobs.investigate.steps.0';

describe('normalizeWorkflowDocument action steps', () => {
  test('normalizes an action step from its manifest', () => {
    const model = normalize(
      document(
        actionStep({
          name: 'Read thread',
          with: {
            channel_id: `$${'{{ vars.CHANNEL }}'}`,
            thread_ts: '1727000000.1234',
            token: `$${'{{ secrets.NPM_TOKEN }}'}`,
          },
          env: {FOO: 'bar'},
        }),
      ),
    );

    const step = model.jobs[0]?.steps[0];
    expect(step).toEqual({
      id: expect.any(String),
      key: 'thread',
      name: 'Read thread',
      kind: 'action',
      action: {
        uses: USES,
        origin: 'local',
        digest: DIGEST,
        name: 'Slack thread to Markdown',
        main: 'index.ts',
        inputs: {
          channel_id: {type: 'string', required: true},
          thread_ts: {type: 'string', required: true},
          token: {type: 'string', required: false},
          destination: {type: 'string', required: false, default: 'context/slack-thread.md'},
          limit: {type: 'number', required: false, default: 100},
          filter: {
            type: 'json',
            schema: {type: 'object', properties: {user: {type: 'string'}}, required: ['user']},
            required: false,
          },
        },
        integrations: {
          slack: {
            provider: 'slack',
            connection: 'team-slack',
            include: ['read_thread'],
            allowWrite: false,
          },
        },
      },
      with: {
        channel_id: `$${'{{ vars.CHANNEL }}'}`,
        thread_ts: '1727000000.1234',
        token: `$${'{{ secrets.NPM_TOKEN }}'}`,
      },
      env: {FOO: 'bar'},
      outputs: {
        path: {type: 'string', required: true},
        message_count: {type: 'number', required: true},
        complete: {type: 'boolean', required: false},
      },
      templates: {with: expect.any(Object)},
    });
    expect(step?.kind === 'action' ? step.templates?.with : undefined).toEqual({
      channel_id: [expect.objectContaining({kind: 'deferred', roots: ['vars']})],
      token: [expect.objectContaining({kind: 'deferred', fillTarget: 'runner-fill'})],
    });
  });

  test('records the package and version of a registry action', () => {
    const registryUses = 'shipfox/slack-thread@1.4.2';
    const resolved: ResolvedActions = new Map([
      [
        registryUses,
        {
          manifest: manifest(),
          digest: DIGEST,
          registry: {package: 'shipfox/slack-thread', version: '1.4.2'},
        },
      ],
    ]);

    const model = normalize(document(actionStep({uses: registryUses})), resolved);

    const step = model.jobs[0]?.steps[0];
    expect(step?.kind === 'action' ? step.action : undefined).toMatchObject({
      uses: registryUses,
      origin: 'registry',
      package: 'shipfox/slack-thread',
      version: '1.4.2',
      digest: DIGEST,
    });
  });

  test('writes an empty output declaration when the manifest declares no outputs', () => {
    const model = normalize(document(actionStep()), actions(manifest({outputs: undefined})));

    expect(model.jobs[0]?.steps[0]?.outputs).toEqual({});
  });

  test('types later references from the manifest outputs', () => {
    const valid = document(
      actionStep(),
      {run: `echo "$${'{{ steps.thread.outputs.path }}'}"`},
      {run: 'echo done', if: `$${'{{ has(steps.thread.outputs.complete) }}'}`},
    );
    expect(issuesFor(valid)).toEqual([]);

    const invalid = document(actionStep(), {
      run: `echo "$${'{{ steps.thread.outputs.missing }}'}"`,
    });
    expect(issuesFor(invalid)).toEqual([
      {code: 'invalid-interpolation-expression', path: 'jobs.investigate.steps.1.run'},
    ]);
  });

  test('types log_path in run, env, prompt, and action inputs', () => {
    const logPath = `$${'{{ steps.thread.log_path }}'}`;
    const attemptLogPath = `$${'{{ steps.thread.attempts[0].log_path }}'}`;
    const restartLogPath = `$${'{{ step.restart.from.log_path }}'}`;
    const workflow = document(
      actionStep(),
      {key: 'read', run: `cat "${logPath}"`, env: {ATTEMPT_LOG: attemptLogPath}},
      {key: 'ask', prompt: `Read ${logPath} and fix the failure.`},
      actionStep({key: 'again', with: {channel_id: 'C0123', thread_ts: logPath}}),
      {key: 'recover', run: `cat "${restartLogPath}"`, env: {LOG: restartLogPath}},
      {
        key: 'ask_restart',
        prompt: `Read ${restartLogPath} and fix the failure.`,
        if: `$${'{{ has(step.restart) && has(step.restart.from.log_path) }}'}`,
      },
      {key: 'check', run: 'false', gate: {on_failure: {restart_from: 'recover'}}},
    );

    expect(issuesFor(workflow)).toEqual([]);
  });

  test('does not type log_path on jobs', () => {
    const workflow: WorkflowDocument = {
      name: 'jobs',
      runner: 'ubuntu-latest',
      jobs: {
        build: {steps: [{run: 'echo build'}]},
        deploy: {
          needs: 'build',
          if: `$${'{{ jobs.build.log_path != "" }}'}`,
          steps: [{run: 'echo deploy'}],
        },
      },
    };

    expect(issuesFor(workflow)).toEqual([{code: 'invalid-job-if', path: 'jobs.deploy.if'}]);
  });

  test('accepts literals that dispatch coerces to the declared type', () => {
    const step = actionStep({with: {channel_id: 'C1', thread_ts: '1.0', limit: '42'}});

    expect(issuesFor(document(step))).toEqual([]);
  });

  test('allows write tools when the manifest sets allow_write', () => {
    const writer = manifest({
      integrations: {slack: {provider: 'slack', include: ['post_message'], allow_write: true}},
    });

    expect(issuesFor(document(actionStep()), actions(writer))).toEqual([]);
  });

  test('skips connection checks without an integration validation context', () => {
    const model = normalizeWorkflowDocument(document(actionStep({connections: {slack: 'ghost'}})), {
      agentValidationCatalog,
      actionManifests: actions(),
    });

    expect(model.jobs[0]?.steps[0]).toMatchObject({
      action: {integrations: {slack: {connection: 'ghost'}}},
    });
  });

  test.each<{
    name: string;
    step?: Partial<WorkflowDocumentStep>;
    manifest?: ActionManifest;
    expected: {code: string; path: string}[];
  }>([
    {
      name: 'an action without a resolved manifest',
      step: {uses: './.shipfox/actions/other'},
      expected: [{code: 'action-not-resolved', path: `${stepPath}.uses`}],
    },
    {
      name: 'an unknown input',
      step: {with: {channel_id: 'C1', thread_ts: '1.0', nope: 'x'}},
      expected: [{code: 'action-input-unknown', path: `${stepPath}.with.nope`}],
    },
    {
      name: 'a missing required input',
      step: {with: {channel_id: 'C1'}},
      expected: [{code: 'action-input-missing', path: `${stepPath}.with.thread_ts`}],
    },
    {
      name: 'a required input with a default',
      manifest: manifest({inputs: {channel_id: {required: true, default: 'C1'}}}),
      step: {with: {}},
      expected: [{code: 'action-input-missing', path: `${stepPath}.with.channel_id`}],
    },
    {
      name: 'a literal of the wrong type',
      step: {with: {channel_id: 'C1', thread_ts: '1.0', limit: 'many'}},
      expected: [{code: 'action-input-invalid', path: `${stepPath}.with.limit`}],
    },
    {
      name: 'a string input given a number',
      step: {with: {channel_id: 'C1', thread_ts: 1.5}},
      expected: [{code: 'action-input-invalid', path: `${stepPath}.with.thread_ts`}],
    },
    {
      name: 'a json literal that fails its schema',
      step: {with: {channel_id: 'C1', thread_ts: '1.0', filter: {team: 'x'}}},
      expected: [{code: 'action-input-invalid', path: `${stepPath}.with.filter`}],
    },
    {
      name: 'a secret nested inside an input',
      step: {
        with: {
          channel_id: 'C1',
          thread_ts: '1.0',
          filter: {user: `$${'{{ secrets.NPM_TOKEN }}'}`},
        },
      },
      expected: [{code: 'action-secret-input-invalid', path: `${stepPath}.with.filter.user`}],
    },
    {
      name: 'a secret embedded in a larger string',
      step: {with: {channel_id: 'C1', thread_ts: `ts-$${'{{ secrets.NPM_TOKEN }}'}`}},
      expected: [{code: 'action-secret-input-invalid', path: `${stepPath}.with.thread_ts`}],
    },
    {
      name: 'a secret inside a larger expression',
      step: {
        with: {channel_id: 'C1', thread_ts: '1.0', token: `$${"{{ secrets.NPM_TOKEN + 'x' }}"}`},
      },
      expected: [{code: 'runner-context-not-bare', path: `${stepPath}.with.token`}],
    },
    {
      name: 'a binding for an undeclared alias',
      step: {connections: {slack: 'team-slack', github: 'github-main'}},
      expected: [{code: 'action-connection-unknown', path: `${stepPath}.connections.github`}],
    },
    {
      name: 'a declared alias without a binding',
      step: {connections: undefined},
      expected: [{code: 'action-connection-missing', path: `${stepPath}.connections`}],
    },
    {
      name: 'a binding to an unknown connection',
      step: {connections: {slack: 'ghost'}},
      expected: [{code: 'integration-connection-not-found', path: `${stepPath}.connections.slack`}],
    },
    {
      name: 'a binding to a connection of another provider',
      step: {connections: {slack: 'github-main'}},
      expected: [
        {code: 'integration-connection-provider-mismatch', path: `${stepPath}.connections.slack`},
      ],
    },
    {
      name: 'a binding to a connection without agent tools',
      step: {connections: {slack: 'slack-no-tools'}},
      expected: [
        {code: 'integration-connection-not-capable', path: `${stepPath}.connections.slack`},
      ],
    },
    {
      name: 'an unknown manifest selector',
      manifest: manifest({integrations: {slack: {provider: 'slack', include: ['read_all']}}}),
      expected: [{code: 'unknown-integration-tool', path: `${stepPath}.uses`}],
    },
    {
      name: 'an unknown manifest method',
      manifest: manifest({
        integrations: {slack: {provider: 'slack', include: ['channels.archive']}},
      }),
      expected: [{code: 'unknown-integration-method', path: `${stepPath}.uses`}],
    },
    {
      name: 'a write selector without allow_write',
      manifest: manifest({integrations: {slack: {provider: 'slack', include: ['post_message']}}}),
      expected: [{code: 'integration-write-not-allowed', path: `${stepPath}.uses`}],
    },
    {
      name: 'a manifest schema that is not valid JSON Schema',
      manifest: {
        ...manifest(),
        outputs: {data: {type: 'json', schema: {type: 'nope'}, required: false}},
      },
      expected: [{code: 'action-manifest-invalid', path: `${stepPath}.uses`}],
    },
  ])('reports $name', ({step, manifest: value, expected}) => {
    expect(issuesFor(document(actionStep(step)), actions(value))).toEqual(expected);
  });
});
