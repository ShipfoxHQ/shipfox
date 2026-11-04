import {integrationsInterModuleContract} from '@shipfox/api-integration-core-dto/inter-module';
import {createInterModuleKnownError} from '@shipfox/inter-module';
import {agentValidationCatalog} from '#test/agent-validation-catalog.js';
import type {IntegrationValidationContext} from './entities/integration-context.js';
import type {DefinitionsSourceControl} from './integrations.js';
import {fetchAndParseAgents} from './sync-agents.js';
import type {InteractionRequestSchemas} from './workflow-model/validate-agent-rules.js';

const context = {
  workspaceId: 'workspace-1',
  sourceConnectionId: 'connection-1',
  sourceExternalRepositoryId: 'gitea:gitea-owner/platform',
  ref: 'abc123',
  agentValidationCatalog,
};

const reviewerYaml = `
name: Reviewer
description: Reviews pull requests.
instructions:
  - Be brief.
  - file: ./.shipfox/prompts/review.md
model: claude-opus-4-8
provider: anthropic
thinking: high
`;

function repositorySourceControl(repository: Record<string, string>): DefinitionsSourceControl {
  return {
    resolveRepository: vi.fn(),
    listFiles: vi.fn(),
    fetchFile: vi.fn(({path, ref}: {path: string; ref: string}) => {
      const content = repository[path];
      if (content === undefined) {
        return Promise.reject(
          createInterModuleKnownError(
            integrationsInterModuleContract.methods.fetchSourceFile,
            'provider-failure',
            {reason: 'file-not-found'},
          ),
        );
      }
      return Promise.resolve({path, ref, content});
    }),
  };
}

function parse(
  repository: Record<string, string>,
  paths = Object.keys(repository),
  loadIntegrationValidationContext?: () => Promise<IntegrationValidationContext>,
  loadInteractionRequestSchemas?: () => Promise<InteractionRequestSchemas>,
) {
  return fetchAndParseAgents({
    ...context,
    paths: paths.filter((path) => path.startsWith('.shipfox/agents/')),
    sourceControl: repositorySourceControl(repository),
    ...(loadIntegrationValidationContext === undefined ? {} : {loadIntegrationValidationContext}),
    ...(loadInteractionRequestSchemas === undefined ? {} : {loadInteractionRequestSchemas}),
  });
}

const selectors = [
  {token: 'issue_read', kind: 'family', sensitivity: 'read', sensitive: false},
  {token: 'issue_read.get', kind: 'method', sensitivity: 'read', sensitive: false},
  {token: 'issue_write', kind: 'family', sensitivity: 'write', sensitive: true},
  {token: 'issue_write.create', kind: 'method', sensitivity: 'write', sensitive: true},
  {token: 'issue_write.update', kind: 'method', sensitivity: 'write', sensitive: true},
  {token: 'issue_write.list', kind: 'method', sensitivity: 'read', sensitive: false},
] as const;

function integrationContext(
  overrides: Partial<IntegrationValidationContext> = {},
): IntegrationValidationContext {
  return {
    agentToolSelectionCatalogs: new Map([['github', {selectors}]]),
    agentToolCatalogs: new Map(),
    workspaceConnectionSnapshot: new Map([
      [
        'github-main',
        {id: 'connection-1', provider: 'github', capabilities: ['agent_tools'], allowed: true},
      ],
      ['hooks', {id: 'connection-2', provider: 'webhook', capabilities: [], allowed: true}],
    ]),
    eventCatalogs: new Map(),
    fixedEventProviders: new Set(),
    defaultConnectionSlug: 'github-main',
    ...overrides,
  };
}

describe('fetchAndParseAgents', () => {
  it('parses a custom agent, inlines its prompt file, and keys it by file name', async () => {
    const result = await parse({
      '.shipfox/agents/reviewer.yaml': reviewerYaml,
      '.shipfox/prompts/review.md': 'Report only real bugs.\n',
    });

    expect(result.invalid).toEqual([]);
    expect(result.diagnostics).toEqual([]);
    expect(result.valid).toEqual([
      expect.objectContaining({
        key: 'reviewer',
        path: '.shipfox/agents/reviewer.yaml',
        name: 'Reviewer',
        description: 'Reviews pull requests.',
        instructions: 'Be brief.\n\nReport only real bugs.',
      }),
    ]);
  });

  it('accepts an empty shippy file', async () => {
    const result = await parse({'.shipfox/agents/shippy.yaml': ''});

    expect(result.valid).toEqual([
      expect.objectContaining({key: 'shippy', instructions: null, document: {}}),
    ]);
  });

  it('rejects a custom agent whose instructions are blank, but not a blank shippy file', async () => {
    const result = await parse({
      '.shipfox/agents/blank.yaml': 'description: Blank.\ninstructions: "  "',
      '.shipfox/agents/empty-part.yaml':
        'description: Empty part.\ninstructions:\n  - file: ./.shipfox/prompts/empty.md',
      '.shipfox/prompts/empty.md': '\n',
      '.shipfox/agents/shippy.yaml': 'instructions: " "',
    });

    expect(result.valid.map((agent) => agent.key)).toEqual(['shippy']);
    expect(result.invalid.map((agent) => agent.key).sort()).toEqual(['blank', 'empty-part']);
    expect(result.invalid[0]?.error.diagnostics).toEqual([
      expect.objectContaining({path: 'instructions', severity: 'error'}),
    ]);
  });

  it('keeps the other files when one is invalid', async () => {
    const result = await parse({
      '.shipfox/agents/shippy.yml': 'instructions: Prefer short answers.',
      '.shipfox/agents/broken.yaml': 'name: Broken',
    });

    expect(result.valid.map((agent) => agent.key)).toEqual(['shippy']);
    expect(result.invalid).toEqual([
      {
        key: 'broken',
        path: '.shipfox/agents/broken.yaml',
        error: {
          message: 'A custom agent requires "description".',
          diagnostics: [
            expect.objectContaining({path: 'description', severity: 'error'}),
            expect.objectContaining({path: 'instructions', severity: 'error'}),
          ],
        },
      },
    ]);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: 'agent-file-invalid',
        filePath: '.shipfox/agents/broken.yaml',
        path: 'description',
      }),
      expect.objectContaining({filePath: '.shipfox/agents/broken.yaml', path: 'instructions'}),
    ]);
  });

  it('reports a nested file without a key, so it creates no agent', async () => {
    const result = await parse({'.shipfox/agents/team/reviewer.yaml': reviewerYaml});

    expect(result.valid).toEqual([]);
    expect(result.invalid).toEqual([]);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: 'agent-file-invalid',
        message: expect.stringContaining('is nested'),
        filePath: '.shipfox/agents/team/reviewer.yaml',
      }),
    ]);
  });

  it('reports invalid YAML and a missing prompt file against the file', async () => {
    const result = await parse({
      '.shipfox/agents/syntax.yaml': 'name: [',
      '.shipfox/agents/reviewer.yaml': reviewerYaml,
    });

    expect(result.valid).toEqual([]);
    expect(result.invalid.map((agent) => agent.key).sort()).toEqual(['reviewer', 'syntax']);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: expect.stringContaining('Invalid agent YAML syntax'),
          filePath: '.shipfox/agents/syntax.yaml',
        }),
        expect.objectContaining({
          message: expect.stringContaining('was not found at this commit'),
          path: 'instructions.1',
          filePath: '.shipfox/agents/reviewer.yaml',
        }),
      ]),
    );
  });

  it('checks the model against the catalog', async () => {
    const result = await parse({
      '.shipfox/agents/shippy.yaml': 'provider: anthropic\nmodel: not-a-model',
    });

    expect(result.valid).toEqual([]);
    expect(result.invalid[0]?.error.diagnostics).toEqual([
      expect.objectContaining({code: 'invalid-model', path: 'model'}),
    ]);
  });

  it('ignores a second file for the same key', async () => {
    const result = await parse({
      '.shipfox/agents/shippy.yaml': 'instructions: A',
      '.shipfox/agents/shippy.yml': 'instructions: B',
    });

    expect(result.valid).toEqual([
      expect.objectContaining({path: '.shipfox/agents/shippy.yaml', instructions: 'A'}),
    ]);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        filePath: '.shipfox/agents/shippy.yml',
        message: expect.stringContaining('already defines the agent'),
      }),
    ]);
  });

  it('keys files under an agent path without a trailing slash', async () => {
    const result = await fetchAndParseAgents({
      ...context,
      agentPath: '.shipfox/agents',
      paths: ['.shipfox/agents/shippy.yaml'],
      sourceControl: repositorySourceControl({'.shipfox/agents/shippy.yaml': ''}),
    });

    expect(result.valid.map((agent) => agent.key)).toEqual(['shippy']);
  });

  it('changes the hash when only the prompt file changes', async () => {
    const first = await parse({
      '.shipfox/agents/reviewer.yaml': reviewerYaml,
      '.shipfox/prompts/review.md': 'One.',
    });
    const second = await parse({
      '.shipfox/agents/reviewer.yaml': reviewerYaml,
      '.shipfox/prompts/review.md': 'Two.',
    });

    expect(first.valid[0]?.contentHash).not.toBe(second.valid[0]?.contentHash);
  });

  describe('integrations', () => {
    const agent = (integrations: string) =>
      `description: Triage.\ninstructions: Triage issues.\nintegrations:\n${integrations}`;

    it('accepts selectors the connection serves and keeps the document as authored', async () => {
      const result = await parse(
        {'.shipfox/agents/triage.yaml': agent('  - include: [issue_read.get]')},
        undefined,
        async () => integrationContext(),
      );

      expect(result.invalid).toEqual([]);
      expect(result.valid[0]?.document.integrations).toEqual([{include: ['issue_read.get']}]);
    });

    it('rejects an unknown tool, with the path of the selector', async () => {
      const result = await parse(
        {'.shipfox/agents/triage.yaml': agent('  - include: [issue_read, missing]')},
        undefined,
        async () => integrationContext(),
      );

      expect(result.valid).toEqual([]);
      expect(result.invalid[0]?.error.diagnostics).toEqual([
        expect.objectContaining({
          code: 'unknown-integration-tool',
          path: 'integrations.0.include.1',
          severity: 'error',
        }),
      ]);
    });

    it('rejects a write tool unless allow_write is true', async () => {
      const files = (allowWrite: string) => ({
        '.shipfox/agents/triage.yaml': agent(`  - include: [issue_write.create]${allowWrite}`),
      });
      const load = async () => integrationContext();

      const refused = await parse(files(''), undefined, load);
      const allowed = await parse(files('\n    allow_write: true'), undefined, load);

      expect(refused.invalid[0]?.error.diagnostics).toEqual([
        expect.objectContaining({
          code: 'integration-write-not-allowed',
          path: 'integrations.0.include',
        }),
      ]);
      expect(allowed.invalid).toEqual([]);
      expect(allowed.valid).toHaveLength(1);
    });

    it('accepts a write family once exclude removes every write method', async () => {
      const files = (exclude: string) => ({
        '.shipfox/agents/triage.yaml': agent(`  - include: [issue_write]\n    exclude: ${exclude}`),
      });
      const load = async () => integrationContext();

      const allExcluded = await parse(
        files('[issue_write.create, issue_write.update]'),
        undefined,
        load,
      );
      const partlyExcluded = await parse(files('[issue_write.create]'), undefined, load);

      expect(allExcluded.invalid).toEqual([]);
      expect(allExcluded.valid).toHaveLength(1);
      expect(partlyExcluded.invalid[0]?.error.diagnostics).toEqual([
        expect.objectContaining({
          code: 'integration-write-not-allowed',
          path: 'integrations.0.include',
        }),
      ]);
    });

    it('rejects an agent integration that exclude empties', async () => {
      const result = await parse(
        {
          '.shipfox/agents/triage.yaml': agent(
            '  - include: [issue_write]\n    exclude: [issue_write.create, issue_write.update, issue_write.list]\n    allow_write: true',
          ),
        },
        undefined,
        async () => integrationContext(),
      );

      expect(result.valid).toEqual([]);
      expect(result.invalid[0]?.error.diagnostics).toEqual([
        expect.objectContaining({
          code: 'integration-no-tools-selected',
          path: 'integrations.0.include',
        }),
      ]);
    });

    it('rejects a connection that does not exist or cannot serve tools', async () => {
      const result = await parse(
        {
          '.shipfox/agents/gone.yaml': agent('  - connection: removed\n    include: [issue_read]'),
          '.shipfox/agents/hooks.yaml': agent('  - connection: hooks\n    include: [issue_read]'),
        },
        undefined,
        async () => integrationContext(),
      );

      expect(
        result.invalid.map((entry) => [entry.key, entry.error.diagnostics[0]?.code]).sort(),
      ).toEqual([
        ['gone', 'integration-connection-not-found'],
        ['hooks', 'integration-connection-not-capable'],
      ]);
    });

    it('needs a named connection when the project has no default', async () => {
      const result = await parse(
        {'.shipfox/agents/triage.yaml': agent('  - include: [issue_read]')},
        undefined,
        async () => integrationContext({defaultConnectionSlug: undefined}),
      );

      expect(result.invalid[0]?.error.diagnostics).toEqual([
        expect.objectContaining({code: 'missing-connection-for-integration'}),
      ]);
    });

    it('loads the workspace context once, and only for a file that uses integrations', async () => {
      const load = vi.fn(async () => integrationContext());

      await parse(
        {
          '.shipfox/agents/plain.yaml': 'description: Plain.\ninstructions: Be plain.',
          '.shipfox/agents/a.yaml': agent('  - include: [issue_read]'),
          '.shipfox/agents/b.yaml': agent('  - include: [issue_read]'),
        },
        undefined,
        load,
      );
      await parse(
        {'.shipfox/agents/plain.yaml': 'description: Plain.\ninstructions: Be plain.'},
        undefined,
        load,
      );

      expect(load).toHaveBeenCalledTimes(1);
    });
  });

  describe('on rules', () => {
    const requestSchemas: InteractionRequestSchemas = new Map([
      [
        'slack',
        {
          type: 'object',
          properties: {channel_id: {type: 'string'}, user_id: {type: 'string'}},
          required: ['channel_id', 'user_id'],
        },
      ],
      [
        'linear',
        {
          type: 'object',
          properties: {
            team_key: {type: 'string'},
            labels: {type: 'array', items: {type: 'string'}},
          },
        },
      ],
    ]);
    const chatContext = () =>
      integrationContext({
        workspaceConnectionSnapshot: new Map([
          [
            'slack',
            {id: 'connection-3', provider: 'slack', capabilities: ['interaction'], allowed: true},
          ],
          [
            'linear',
            {id: 'connection-4', provider: 'linear', capabilities: ['interaction'], allowed: true},
          ],
          ['hooks', {id: 'connection-2', provider: 'webhook', capabilities: [], allowed: true}],
        ]),
      });
    const agent = (on: string) => `description: Payments.\ninstructions: Answer.\non:\n${on}`;
    const parseRules = (on: string) =>
      parse(
        {'.shipfox/agents/payments.yaml': agent(on)},
        undefined,
        async () => chatContext(),
        async () => requestSchemas,
      );

    it('syncs a rule that names a Slack channel', async () => {
      const result = await parseRules(
        '  - source: slack\n    filter: request.channel_id == "C04PAYMENTS"',
      );

      expect(result.invalid).toEqual([]);
      expect(result.valid[0]?.document.on).toEqual([
        {source: 'slack', filter: 'request.channel_id == "C04PAYMENTS"'},
      ]);
    });

    it('syncs a rule with no filter and a filter on the raw event', async () => {
      const result = await parseRules(
        '  - source: slack\n  - source: slack\n    filter: event.type == "app_mention"',
      );

      expect(result.invalid).toEqual([]);
      expect(result.valid[0]?.document.on).toHaveLength(2);
    });

    it('syncs a filter over the labels of a Linear request', async () => {
      const result = await parseRules(
        `  - source: linear\n    filter: "'payments' in request.labels && request.team_key == 'ENG'"`,
      );

      expect(result.invalid).toEqual([]);
      expect(result.valid).toHaveLength(1);
    });

    it('rejects a source without the interaction capability', async () => {
      const result = await parseRules('  - source: hooks');

      expect(result.valid).toEqual([]);
      expect(result.invalid[0]?.error.diagnostics).toEqual([
        expect.objectContaining({code: 'integration-connection-not-capable', path: 'on.0.source'}),
      ]);
    });

    it('rejects a source that is no connection of the workspace', async () => {
      const result = await parseRules('  - source: manual');

      expect(result.invalid[0]?.error.diagnostics).toEqual([
        expect.objectContaining({code: 'integration-connection-not-found', path: 'on.0.source'}),
      ]);
    });

    it('rejects a filter on a field the request does not have', async () => {
      const result = await parseRules('  - source: slack\n    filter: request.labels == "x"');

      expect(result.valid).toEqual([]);
      expect(result.invalid[0]?.error.diagnostics).toEqual([
        expect.objectContaining({code: 'invalid-agent-rule-filter', path: 'on.0.filter'}),
      ]);
    });

    it('rejects a filter that is not a boolean over request and event', async () => {
      for (const filter of ['request.channel_id', 'inputs.x == "y"', 'request.channel_id ==']) {
        const result = await parseRules(`  - source: slack\n    filter: ${filter}`);

        expect(result.invalid[0]?.error.diagnostics[0]?.code).toBe('invalid-agent-rule-filter');
      }
    });

    it('rejects event, with, secrets, and config on a rule', async () => {
      for (const extra of ['event: app_mention', 'with: {}', 'secrets: {}', 'config: {}']) {
        const result = await parseRules(`  - source: slack\n    ${extra}`);

        expect(result.invalid[0]?.error.diagnostics).toEqual([
          expect.objectContaining({code: 'agent-file-invalid'}),
        ]);
      }
    });

    it('rejects a filter too long to index', async () => {
      const filter = `request.channel_id == "${'C'.repeat(2000)}"`;

      const result = await parseRules(`  - source: slack\n    filter: '${filter}'`);

      expect(result.invalid[0]?.error.diagnostics).toEqual([
        expect.objectContaining({code: 'invalid-agent-rule-filter', path: 'on.0.filter'}),
      ]);
    });

    it('checks only the filter syntax when the workspace context is not loaded', async () => {
      const result = await parse({
        '.shipfox/agents/payments.yaml': agent(
          '  - source: slack\n    filter: request.anything == 1',
        ),
      });

      expect(result.invalid).toEqual([]);
    });

    it('loads the request schemas only for a file with rules', async () => {
      const load = vi.fn(async () => requestSchemas);

      await parse(
        {'.shipfox/agents/plain.yaml': 'description: Plain.\ninstructions: Be plain.'},
        undefined,
        async () => chatContext(),
        load,
      );

      expect(load).not.toHaveBeenCalled();
    });
  });

  it('lets a provider outage propagate', async () => {
    const source = repositorySourceControl({});
    const outage = createInterModuleKnownError(
      integrationsInterModuleContract.methods.fetchSourceFile,
      'provider-failure',
      {reason: 'provider-unavailable'},
    );
    vi.mocked(source.fetchFile).mockRejectedValue(outage);

    await expect(
      fetchAndParseAgents({
        ...context,
        paths: ['.shipfox/agents/shippy.yaml'],
        sourceControl: source,
      }),
    ).rejects.toBe(outage);
  });
});
