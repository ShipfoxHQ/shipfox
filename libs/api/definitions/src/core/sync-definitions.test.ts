import {createHash} from 'node:crypto';
import {integrationsInterModuleContract} from '@shipfox/api-integration-core-dto/inter-module';
import {createInterModuleKnownError} from '@shipfox/inter-module';
import {LOWERCASE_SHA256_HEX_RE} from '@shipfox/regex';
import {agentValidationCatalog} from '#test/agent-validation-catalog.js';
import type {IntegrationValidationContext} from './entities/integration-context.js';
import {DefinitionSyncPermanentError} from './errors.js';
import type {DefinitionsSourceControl} from './integrations.js';
import {
  classifySyncFailure,
  discoverWorkflowFiles,
  fetchAndParseWorkflows as fetchAndParseWorkflowsBase,
  resolveSyncSource,
} from './sync-definitions.js';

async function fetchAndParseWorkflows(
  params: Omit<Parameters<typeof fetchAndParseWorkflowsBase>[0], 'agentValidationCatalog'>,
) {
  const result = await fetchAndParseWorkflowsBase({...params, agentValidationCatalog});
  return result.workflows;
}

const validYaml = `
name: CI
runner: ubuntu-latest
jobs:
  build:
    steps:
      - run: pnpm test
`;

const eventInterpolation = '$'.concat('{{ event.x }}');

const warningYaml = `
name: Warning only
runner: ubuntu-latest
jobs:
  build:
    steps:
      - env:
          MSG: '${eventInterpolation}'
        run: eval "$MSG"
`;

const invalidPredicateYaml = `
name: Invalid predicate
runner: ubuntu-latest
jobs:
  build:
    success: 'executions.size()'
    steps:
      - run: echo hello
`;

const YAML_LOCATION_RE = /^\d+:\d+$/;

const validIntegrationYaml = `
name: Agent CI
runner: ubuntu-latest
jobs:
  build:
    steps:
      - prompt: Fix the issue
        integrations:
          - connection: github-main
            include: [issue_read]
`;

const invalidIntegrationYaml = `
name: Agent CI
runner: ubuntu-latest
jobs:
  build:
    steps:
      - prompt: Fix the issue
        integrations:
          - connection: github-main
            include: [issue_read.missing]
`;

const integrationValidationContext = {
  agentToolSelectionCatalogs: new Map([
    [
      'github',
      {
        selectors: [
          {token: 'issue_read', kind: 'family', sensitivity: 'read', sensitive: false},
          {token: 'issue_read.get', kind: 'method', sensitivity: 'read', sensitive: false},
        ],
      },
    ],
  ]),
  agentToolCatalogs: new Map([
    [
      'github',
      {
        tools: [
          {
            id: 'issue_read',
            description: 'Read issues',
            sensitivity: 'read',
            sensitive: false,
            requiredScope: 'read',
            inputSchema: {type: 'object', properties: {number: {type: 'integer'}}},
            methods: [
              {
                id: 'get',
                description: 'Get an issue',
                sensitivity: 'read',
                sensitive: false,
                requiredScope: 'read',
              },
            ],
          },
        ],
      },
    ],
  ]),
  workspaceConnectionSnapshot: new Map([
    ['github-main', {id: 'connection-1', provider: 'github', capabilities: ['agent_tools']}],
    ['deploy-hook', {id: 'connection-2', provider: 'webhook', capabilities: []}],
  ]),
  eventCatalogs: new Map([
    ['github', new Set(['push', 'pull_request.opened'])],
    ['webhook', new Set(['received'])],
  ]),
  fixedEventProviders: new Set(['webhook']),
} satisfies IntegrationValidationContext;

function sourceControl(
  overrides: Partial<DefinitionsSourceControl> = {},
): DefinitionsSourceControl {
  return {
    resolveRepository: vi.fn(() =>
      Promise.resolve({
        connection: {
          id: 'connection-1',
          workspaceId: 'workspace-1',
          provider: 'gitea',
          externalAccountId: 'gitea-owner',
          slug: 'gitea_owner',
          displayName: 'Gitea',
          lifecycleStatus: 'active' as const,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        repository: {
          externalRepositoryId: 'gitea:gitea-owner/platform',
          owner: 'gitea-owner',
          name: 'platform',
          fullName: 'gitea-owner/platform',
          defaultBranch: 'main',
          visibility: 'private' as const,
          cloneUrl: 'https://gitea.local/gitea-owner/platform.git',
          htmlUrl: 'https://gitea.local/gitea-owner/platform',
        },
      }),
    ),
    listFiles: vi.fn(() =>
      Promise.resolve({
        files: [{path: '.shipfox/workflows/ci.yml', type: 'file' as const, size: validYaml.length}],
        nextCursor: null,
      }),
    ),
    fetchFile: vi.fn(() =>
      Promise.resolve({path: '.shipfox/workflows/ci.yml', ref: 'main', content: validYaml}),
    ),
    ...overrides,
  };
}

const baseContext = {
  workspaceId: 'workspace-1',
  sourceConnectionId: 'connection-1',
  sourceExternalRepositoryId: 'gitea:gitea-owner/platform',
};

describe('resolveSyncSource', () => {
  it('returns the repository default branch as ref', async () => {
    const result = await resolveSyncSource({...baseContext, sourceControl: sourceControl()});

    expect(result).toEqual({ref: 'main'});
  });
});

describe('discoverWorkflowFiles', () => {
  it('returns yaml/yml workflow paths', async () => {
    const result = await discoverWorkflowFiles({
      ...baseContext,
      ref: 'main',
      sourceControl: sourceControl({
        listFiles: vi.fn(() =>
          Promise.resolve({
            files: [
              {path: '.shipfox/workflows/ci.yml', type: 'file' as const, size: 64},
              {path: '.shipfox/workflows/deploy.yaml', type: 'file' as const, size: 64},
              {path: '.shipfox/workflows/README.md', type: 'file' as const, size: 64},
            ],
            nextCursor: null,
          }),
        ),
      }),
    });

    expect(result.paths).toEqual(['.shipfox/workflows/ci.yml', '.shipfox/workflows/deploy.yaml']);
  });

  it('skips symlinks and submodules even with a yaml extension', async () => {
    const result = await discoverWorkflowFiles({
      ...baseContext,
      ref: 'main',
      sourceControl: sourceControl({
        listFiles: vi.fn(() =>
          Promise.resolve({
            files: [
              {path: '.shipfox/workflows/ci.yml', type: 'file' as const, size: 64},
              {path: '.shipfox/workflows/linked.yml', type: 'symlink' as const, size: 12},
              {path: '.shipfox/workflows/shared.yaml', type: 'submodule' as const, size: 0},
            ],
            nextCursor: null,
          }),
        ),
      }),
    });

    expect(result.paths).toEqual(['.shipfox/workflows/ci.yml']);
  });

  it('lists workflows under the configured repository path', async () => {
    const listFiles = vi.fn(() =>
      Promise.resolve({
        files: [{path: '.shipfox/staging/workflows/ci.yml', type: 'file' as const, size: 64}],
        nextCursor: null,
      }),
    );

    const result = await discoverWorkflowFiles({
      ...baseContext,
      ref: 'main',
      workflowPath: '.shipfox/staging/workflows/',
      sourceControl: sourceControl({listFiles}),
    });

    expect(listFiles).toHaveBeenCalledWith(
      expect.objectContaining({prefix: '.shipfox/staging/workflows/'}),
    );
    expect(result.paths).toEqual(['.shipfox/staging/workflows/ci.yml']);
  });

  it('throws no-workflow-files when nothing matches the yaml extensions', async () => {
    const result = discoverWorkflowFiles({
      ...baseContext,
      ref: 'main',
      sourceControl: sourceControl({
        listFiles: vi.fn(() =>
          Promise.resolve({
            files: [{path: '.shipfox/workflows/README.md', type: 'file' as const, size: 1}],
            nextCursor: null,
          }),
        ),
      }),
    });

    await expect(result).rejects.toMatchObject({code: 'no-workflow-files'});
  });

  it('includes the configured repository path when no workflow files are found', async () => {
    const result = discoverWorkflowFiles({
      ...baseContext,
      ref: 'main',
      workflowPath: '.shipfox/production/workflows/',
      sourceControl: sourceControl({
        listFiles: vi.fn(() => Promise.resolve({files: [], nextCursor: null})),
      }),
    });

    await expect(result).rejects.toThrow(
      'No workflow files were found under .shipfox/production/workflows/',
    );
  });

  it('throws too-many-files when the listing reports more pages', async () => {
    const result = discoverWorkflowFiles({
      ...baseContext,
      ref: 'main',
      sourceControl: sourceControl({
        listFiles: vi.fn(() =>
          Promise.resolve({
            files: [{path: '.shipfox/workflows/ci.yml', type: 'file' as const, size: 1}],
            nextCursor: '1',
          }),
        ),
      }),
    });

    await expect(result).rejects.toMatchObject({code: 'too-many-files'});
  });
});

describe('fetchAndParseWorkflows', () => {
  it('fetches and parses each provided path', async () => {
    const result = await fetchAndParseWorkflows({
      ...baseContext,
      ref: 'main',
      paths: ['.shipfox/workflows/ci.yml'],
      sourceControl: sourceControl(),
    });

    expect(result).toHaveLength(1);
    expect(result[0]?.name).toBe('CI');
    expect(result[0]?.path).toBe('.shipfox/workflows/ci.yml');
    expect(result[0]?.contentHash).toMatch(LOWERCASE_SHA256_HEX_RE);
    expect(result[0]?.diagnostics).toEqual([]);
  });

  it('keeps warning-only definitions available to the sync path', async () => {
    const result = await fetchAndParseWorkflows({
      ...baseContext,
      ref: 'main',
      paths: ['.shipfox/workflows/warning.yml'],
      sourceControl: sourceControl({
        fetchFile: vi.fn(() =>
          Promise.resolve({
            path: '.shipfox/workflows/warning.yml',
            ref: 'main',
            content: warningYaml,
          }),
        ),
      }),
    });

    expect(result[0]?.diagnostics).toMatchObject([
      {
        code: 're-evaluating-command',
        path: 'jobs.build.steps.0.run',
        severity: 'warning',
      },
    ]);
    expect(result[0]?.definition.model.jobs[0]?.steps).toHaveLength(1);
  });

  it('keeps definitions with inert trigger-scoped errors available to the sync path', async () => {
    const brokenTriggerPath = '.shipfox/workflows/broken-trigger.yml';
    const validTriggerPath = '.shipfox/workflows/valid-trigger.yml';
    const brokenTriggerYaml = `
name: Broken trigger
runner: ubuntu-latest
triggers:
  nightly:
    source: cron
    event: tick
    config:
      schedule: "not a cron"
  on_demand:
    source: manual
    event: fire
jobs:
  build:
    steps:
      - run: pnpm test
`;

    const fetchFile = vi.fn(({path}: {path: string}) =>
      Promise.resolve({
        path,
        ref: 'main',
        content: path === brokenTriggerPath ? brokenTriggerYaml : validYaml,
      }),
    );
    const result = await fetchAndParseWorkflows({
      ...baseContext,
      ref: 'main',
      paths: [brokenTriggerPath, validTriggerPath],
      sourceControl: sourceControl({fetchFile}),
    });

    expect(result).toHaveLength(2);
    expect(result[0]?.diagnostics).toEqual([
      {
        code: 'invalid-cron-schedule',
        message: 'Cron trigger schedule must be a valid 5-field cron expression.',
        path: 'triggers.nightly.config.schedule',
        severity: 'error',
      },
    ]);
    // The broken cron trigger is inert; the manual trigger stays active.
    expect(result[0]?.definition.model.triggers.map((trigger) => trigger.key)).toEqual([
      'on_demand',
    ]);
    expect(result[1]?.path).toBe(validTriggerPath);
    expect(result[1]?.diagnostics).toEqual([]);
    expect(result[1]?.definition.model.jobs[0]?.steps).toHaveLength(1);
  });

  it('produces stable content hashes for identical content', async () => {
    const sourceControlA = sourceControl();
    const sourceControlB = sourceControl();

    const a = await fetchAndParseWorkflows({
      ...baseContext,
      ref: 'main',
      paths: ['.shipfox/workflows/ci.yml'],
      sourceControl: sourceControlA,
    });
    const b = await fetchAndParseWorkflows({
      ...baseContext,
      ref: 'main',
      paths: ['.shipfox/workflows/ci.yml'],
      sourceControl: sourceControlB,
    });

    expect(a[0]?.contentHash).toBe(b[0]?.contentHash);
  });

  it('rejects oversized contents as content-too-large', async () => {
    const huge = 'x'.repeat(1_000_001);
    const result = fetchAndParseWorkflows({
      ...baseContext,
      ref: 'main',
      paths: ['.shipfox/workflows/big.yml'],
      sourceControl: sourceControl({
        fetchFile: vi.fn(() =>
          Promise.resolve({path: '.shipfox/workflows/big.yml', ref: 'main', content: huge}),
        ),
      }),
    });

    await expect(result).rejects.toBeInstanceOf(DefinitionSyncPermanentError);
    await expect(result).rejects.toMatchObject({code: 'content-too-large'});
  });

  it('rejects a workflow file that is not UTF-8 text with a file diagnostic', async () => {
    const path = '.shipfox/workflows/binary.yml';
    const result = fetchAndParseWorkflows({
      ...baseContext,
      ref: 'main',
      paths: [path],
      sourceControl: sourceControl({
        fetchFile: vi.fn(() =>
          Promise.reject(
            createInterModuleKnownError(
              integrationsInterModuleContract.methods.fetchSourceFile,
              'provider-failure',
              {reason: 'binary-file-unsupported'},
            ),
          ),
        ),
      }),
    });

    const error = await result.catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(DefinitionSyncPermanentError);
    expect(classifySyncFailure(error)).toEqual({
      code: 'invalid-definition',
      message: `Workflow file is not UTF-8 text: ${path}`,
      retryable: false,
      diagnostics: [
        {
          code: 'invalid-definition',
          message: `Workflow file is not UTF-8 text: ${path}`,
          severity: 'error',
          filePath: path,
        },
      ],
    });
  });

  it('rejects invalid YAML as invalid-definition', async () => {
    const result = fetchAndParseWorkflows({
      ...baseContext,
      ref: 'main',
      paths: ['.shipfox/workflows/bad.yml'],
      sourceControl: sourceControl({
        fetchFile: vi.fn(() =>
          Promise.resolve({
            path: '.shipfox/workflows/bad.yml',
            ref: 'main',
            content: 'name: Bad\n  broken:\nindent',
          }),
        ),
      }),
    });

    await expect(result).rejects.toMatchObject({
      code: 'invalid-definition',
      details: [
        expect.objectContaining({
          message: expect.stringContaining('Invalid workflow YAML syntax'),
          path: expect.stringMatching(YAML_LOCATION_RE),
        }),
      ],
    });
  });

  it('retains invalid document validation paths on invalid-definition sync failures', async () => {
    const result = fetchAndParseWorkflows({
      ...baseContext,
      ref: 'main',
      paths: ['.shipfox/workflows/missing-name.yml'],
      sourceControl: sourceControl({
        fetchFile: vi.fn(() =>
          Promise.resolve({
            path: '.shipfox/workflows/missing-name.yml',
            ref: 'main',
            content: `
runner: ubuntu-latest
jobs:
  build:
    steps:
      - run: echo hello
`,
          }),
        ),
      }),
    });

    await expect(result).rejects.toMatchObject({
      code: 'invalid-definition',
      details: [expect.objectContaining({path: 'name'})],
    });
  });

  it('retains validation details on invalid-definition sync failures', async () => {
    const result = fetchAndParseWorkflows({
      ...baseContext,
      ref: 'main',
      paths: ['.shipfox/workflows/invalid.yml'],
      sourceControl: sourceControl({
        fetchFile: vi.fn(() =>
          Promise.resolve({
            path: '.shipfox/workflows/invalid.yml',
            ref: 'main',
            content: invalidPredicateYaml,
          }),
        ),
      }),
    });

    await expect(result).rejects.toMatchObject({
      code: 'invalid-definition',
      details: [
        expect.objectContaining({
          path: 'jobs.build.success',
          reason: expect.stringContaining('must return bool'),
        }),
      ],
    });
  });

  it('emits onProgress for every path', async () => {
    const onProgress = vi.fn();
    await fetchAndParseWorkflows({
      ...baseContext,
      ref: 'main',
      paths: ['.shipfox/workflows/ci.yml'],
      sourceControl: sourceControl(),
      onProgress,
    });

    expect(onProgress).toHaveBeenCalledWith('.shipfox/workflows/ci.yml');
  });

  it('does not load integration validation context when no workflow uses integrations', async () => {
    const loadIntegrationValidationContext = vi.fn(() =>
      Promise.resolve(integrationValidationContext),
    );

    const result = await fetchAndParseWorkflows({
      ...baseContext,
      ref: 'main',
      paths: ['.shipfox/workflows/ci.yml'],
      sourceControl: sourceControl(),
      loadIntegrationValidationContext,
    });

    expect(loadIntegrationValidationContext).not.toHaveBeenCalled();
    expect(result[0]).not.toHaveProperty('rawContent');
  });

  it('loads integration validation context once and reparses integration workflows', async () => {
    const loadIntegrationValidationContext = vi.fn(() =>
      Promise.resolve(integrationValidationContext),
    );

    const result = await fetchAndParseWorkflows({
      ...baseContext,
      ref: 'main',
      paths: ['.shipfox/workflows/ci.yml', '.shipfox/workflows/agent.yml'],
      sourceControl: sourceControl({
        fetchFile: vi.fn(({path}) =>
          Promise.resolve({
            path,
            ref: 'main',
            content: path.endsWith('/agent.yml') ? validIntegrationYaml : validYaml,
          }),
        ),
      }),
      loadIntegrationValidationContext,
    });

    expect(loadIntegrationValidationContext).toHaveBeenCalledTimes(1);
    expect(result).toHaveLength(2);
    expect(result[0]).not.toHaveProperty('rawContent');
    expect(result[1]?.definition.model.jobs[0]?.steps[0]).toMatchObject({
      kind: 'agent',
      integrations: [{connection: 'github-main', include: ['issue_read']}],
    });
  });

  it('loads integration validation context for a trigger-only document', async () => {
    const triggerYaml = `
name: Trigger only
runner: ubuntu-latest
triggers:
  on_push:
    source: github-main
    event: push
jobs:
  build:
    steps:
      - run: pnpm test
`;
    const loadIntegrationValidationContext = vi.fn(() =>
      Promise.resolve(integrationValidationContext),
    );

    const result = await fetchAndParseWorkflows({
      ...baseContext,
      ref: 'main',
      paths: ['.shipfox/workflows/ci.yml'],
      sourceControl: sourceControl({
        fetchFile: vi.fn(() =>
          Promise.resolve({
            path: '.shipfox/workflows/ci.yml',
            ref: 'main',
            content: triggerYaml,
          }),
        ),
      }),
      loadIntegrationValidationContext,
    });

    expect(loadIntegrationValidationContext).toHaveBeenCalledTimes(1);
    expect(result[0]?.definition.model.triggers).toEqual([
      expect.objectContaining({source: 'github-main', event: 'push'}),
    ]);
    expect(result[0]?.diagnostics).toEqual([]);
  });

  it('reports trigger-scoped source and event diagnostics on the sync path', async () => {
    const triggerYaml = `
name: Unknown trigger source
runner: ubuntu-latest
triggers:
  on_deploy:
    source: unknown_slug
    event: whatever
jobs:
  build:
    steps:
      - run: pnpm test
`;
    const loadIntegrationValidationContext = vi.fn(() =>
      Promise.resolve(integrationValidationContext),
    );

    const result = await fetchAndParseWorkflows({
      ...baseContext,
      ref: 'main',
      paths: ['.shipfox/workflows/ci.yml'],
      sourceControl: sourceControl({
        fetchFile: vi.fn(() =>
          Promise.resolve({
            path: '.shipfox/workflows/ci.yml',
            ref: 'main',
            content: triggerYaml,
          }),
        ),
      }),
      loadIntegrationValidationContext,
    });

    expect(result[0]?.diagnostics).toEqual([
      {
        code: 'unknown-trigger-source',
        message:
          'Source "unknown_slug" matches no connection in this workspace; the trigger stays active and fires once a connection with this slug exists.',
        path: 'triggers.on_deploy',
        severity: 'warning',
      },
    ]);
    expect(result[0]?.definition.model.triggers).toEqual([
      expect.objectContaining({source: 'unknown_slug', event: 'whatever'}),
    ]);
  });

  it('keeps invalid trigger events inert on the sync path', async () => {
    const triggerYaml = `
name: Invalid webhook event
runner: ubuntu-latest
triggers:
  on_deploy:
    source: deploy-hook
    event: deployed
jobs:
  build:
    steps:
      - run: pnpm test
`;
    const loadIntegrationValidationContext = vi.fn(() =>
      Promise.resolve(integrationValidationContext),
    );

    const result = await fetchAndParseWorkflows({
      ...baseContext,
      ref: 'main',
      paths: ['.shipfox/workflows/ci.yml'],
      sourceControl: sourceControl({
        fetchFile: vi.fn(() =>
          Promise.resolve({
            path: '.shipfox/workflows/ci.yml',
            ref: 'main',
            content: triggerYaml,
          }),
        ),
      }),
      loadIntegrationValidationContext,
    });

    expect(result[0]?.diagnostics).toEqual([
      {
        code: 'invalid-trigger-event',
        message: 'A webhook trigger must use event "received"; found "deployed".',
        path: 'triggers.on_deploy.event',
        severity: 'error',
      },
    ]);
    expect(result[0]?.definition.model.triggers).toEqual([]);
  });

  it('rejects integration catalog issues after loading validation context', async () => {
    const loadIntegrationValidationContext = vi.fn(() =>
      Promise.resolve(integrationValidationContext),
    );

    const result = fetchAndParseWorkflows({
      ...baseContext,
      ref: 'main',
      paths: ['.shipfox/workflows/agent.yml'],
      sourceControl: sourceControl({
        fetchFile: vi.fn(() =>
          Promise.resolve({
            path: '.shipfox/workflows/agent.yml',
            ref: 'main',
            content: invalidIntegrationYaml,
          }),
        ),
      }),
      loadIntegrationValidationContext,
    });

    await expect(result).rejects.toMatchObject({code: 'invalid-definition'});
    expect(loadIntegrationValidationContext).toHaveBeenCalledTimes(1);
  });
});

describe('fetchAndParseWorkflows with actions', () => {
  const workflowPath = '.shipfox/workflows/ci.yml';
  const actionYaml = `
name: Actions
runner: ubuntu-latest
jobs:
  build:
    steps:
      - uses: ./.shipfox/actions/notify
`;

  function actionRepository(overrides: Record<string, string> = {}): Record<string, string> {
    return {
      [workflowPath]: actionYaml,
      '.shipfox/actions/notify/action.yml': 'name: Notify\nmain: index.ts\n',
      '.shipfox/actions/notify/index.ts': "import {format} from './lib/format.ts';\n",
      '.shipfox/actions/notify/lib/format.ts': 'export const format = 1;\n',
      ...overrides,
    };
  }

  function repositorySourceControl(repository: Record<string, string>) {
    return sourceControl({
      listFiles: vi.fn(({prefix}: {prefix: string}) =>
        Promise.resolve({
          files: Object.entries(repository)
            .filter(([path]) => path.startsWith(prefix))
            .map(([path, content]) => ({
              path,
              type: 'file' as const,
              size: Buffer.byteLength(content, 'utf8'),
            })),
          nextCursor: null,
        }),
      ),
      fetchFile: vi.fn(({path, ref}: {path: string; ref: string}) =>
        Promise.resolve({path, ref, content: repository[path] ?? ''}),
      ),
    });
  }

  function sync(params: {
    repository: Record<string, string>;
    paths?: string[];
    actionsEnabled?: boolean;
    source?: DefinitionsSourceControl;
  }) {
    return fetchAndParseWorkflowsBase({
      ...baseContext,
      ref: 'abc123',
      paths: params.paths ?? [workflowPath],
      sourceControl: params.source ?? repositorySourceControl(params.repository),
      agentValidationCatalog,
      actionsEnabled: params.actionsEnabled ?? true,
    });
  }

  it('reads the referenced action at the sync ref and normalizes the step', async () => {
    const source = repositorySourceControl(actionRepository());

    const result = await sync({repository: {}, source});

    expect(source.listFiles).toHaveBeenCalledWith(
      expect.objectContaining({prefix: '.shipfox/actions/notify/', ref: 'abc123'}),
    );
    expect(result.actions).toHaveLength(1);
    expect(result.workflows[0]?.definition.model.jobs[0]?.steps[0]).toMatchObject({
      kind: 'action',
      action: {
        uses: './.shipfox/actions/notify',
        name: 'Notify',
        digest: result.actions[0]?.bundle.digest,
      },
    });
    expect(result.actionDiagnostics).toEqual([]);
  });

  it('keeps the YAML-only hash for workflows without actions', async () => {
    const result = await sync({repository: {[workflowPath]: validYaml}});

    expect(result.workflows[0]?.contentHash).toBe(
      createHash('sha256').update(validYaml, 'utf8').digest('hex'),
    );
    expect(result.actions).toEqual([]);
  });

  it('changes the hash when only action code changes', async () => {
    const before = await sync({repository: actionRepository()});
    const unchanged = await sync({repository: actionRepository()});
    const after = await sync({
      repository: actionRepository({
        '.shipfox/actions/notify/lib/format.ts': 'export const format = 2;\n',
      }),
    });

    expect(unchanged.workflows[0]?.contentHash).toBe(before.workflows[0]?.contentHash);
    expect(after.workflows[0]?.contentHash).not.toBe(before.workflows[0]?.contentHash);
  });

  it('reads an action shared by several workflows once', async () => {
    const otherPath = '.shipfox/workflows/other.yml';
    const source = repositorySourceControl(actionRepository({[otherPath]: actionYaml}));

    const result = await sync({repository: {}, source, paths: [workflowPath, otherPath]});

    expect(result.workflows).toHaveLength(2);
    expect(result.actions).toHaveLength(1);
    expect(source.listFiles).toHaveBeenCalledTimes(1);
  });

  it('rejects uses as not supported yet when actions are disabled', async () => {
    const source = repositorySourceControl(actionRepository());

    const error = await sync({repository: {}, source, actionsEnabled: false}).catch(
      (caught: unknown) => caught,
    );

    expect(error).toMatchObject({
      code: 'invalid-definition',
      filePath: workflowPath,
      details: [{message: 'Action steps (`uses`) are not supported yet.'}],
    });
    expect(source.listFiles).not.toHaveBeenCalled();
  });

  it('reports manifest problems against the action.yml path', async () => {
    const error = await sync({
      repository: actionRepository({
        '.shipfox/actions/notify/action.yml': 'name: Notify\nmain: missing.ts\n',
      }),
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(DefinitionSyncPermanentError);
    expect(classifySyncFailure(error)).toMatchObject({
      code: 'action-invalid',
      retryable: false,
      diagnostics: [
        {
          code: 'action-invalid',
          filePath: '.shipfox/actions/notify/action.yml',
          path: 'main',
          severity: 'error',
        },
      ],
    });
  });

  it('reports a missing action directory as action-not-found', async () => {
    const error = await sync({repository: {[workflowPath]: actionYaml}}).catch(
      (caught: unknown) => caught,
    );

    expect(classifySyncFailure(error)).toMatchObject({code: 'action-not-found', retryable: false});
  });

  it('warns about unresolved relative imports with the repository path', async () => {
    const result = await sync({
      repository: actionRepository({
        '.shipfox/actions/notify/index.ts': "import {graph} from './lib/graph.ts';\n",
      }),
    });

    expect(result.actionDiagnostics).toEqual([
      {
        code: 'action-import-unresolved',
        message: 'index.ts imports ./lib/graph.ts, which is not in the action',
        severity: 'warning',
        filePath: '.shipfox/actions/notify/index.ts',
      },
    ]);
  });
});

describe('classifySyncFailure', () => {
  it.each([
    ['rate-limited', true, 'provider-rate-limited'],
    ['timeout', true, 'provider-timeout'],
    ['provider-unavailable', true, 'provider-unavailable'],
    ['access-denied', false, 'provider-access-denied'],
    ['repository-not-found', false, 'provider-repository-not-found'],
    ['file-not-found', false, 'provider-file-not-found'],
    ['malformed-provider-response', false, 'provider-malformed-response'],
    ['content-too-large', false, 'content-too-large'],
    ['too-many-files', false, 'too-many-files'],
  ])('maps provider failures (%s) to retryable=%s code=%s', (reason, retryable, code) => {
    const error = createInterModuleKnownError(
      integrationsInterModuleContract.methods.resolveSourceRepository,
      'provider-failure',
      {reason},
    );
    const result = classifySyncFailure(error);

    expect(result).toEqual({code, message: error.message, retryable});
  });

  it('classifies DefinitionSyncPermanentError as non-retryable', () => {
    const details = [
      {
        message: 'Step gate success must be a valid CEL boolean expression.',
        path: 'jobs.build.steps.0.gate.success',
        reason: 'No such key: attempt',
      },
    ];
    const result = classifySyncFailure(
      new DefinitionSyncPermanentError(
        'invalid-definition',
        'bad yaml',
        details,
        '.shipfox/workflows/invalid.yml',
      ),
    );

    expect(result).toEqual({
      code: 'invalid-definition',
      message: 'bad yaml',
      retryable: false,
      diagnostics: [
        {
          code: 'invalid-definition',
          message: 'Step gate success must be a valid CEL boolean expression: No such key: attempt',
          path: 'jobs.build.steps.0.gate.success',
          severity: 'error',
          filePath: '.shipfox/workflows/invalid.yml',
        },
      ],
    });
  });

  it.each([
    'connection-not-found',
    'connection-inactive',
    'connection-workspace-mismatch',
  ] as const)('classifies %s as non-retryable connection-unavailable', (code) => {
    const error = createInterModuleKnownError(
      integrationsInterModuleContract.methods.resolveSourceRepository,
      code,
      {connectionId: '00000000-0000-0000-0000-000000000000'},
    );

    const result = classifySyncFailure(error);

    expect(result).toEqual({
      code: 'connection-unavailable',
      message: error.message,
      retryable: false,
    });
  });

  it('falls back to unknown + retryable for plain errors', () => {
    const result = classifySyncFailure(new Error('boom'));

    expect(result).toEqual({code: 'unknown', message: 'boom', retryable: true});
  });
});
