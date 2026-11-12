import type {AgentToolCatalogEntry} from '@shipfox/api-integration-spi';
import {
  AgentToolsSelectionError,
  type ResolveAgentToolsContext,
  resolveAgentToolsGrant,
} from './resolve-agent-tools.js';

const issueRead: AgentToolCatalogEntry = {
  id: 'issue_read',
  description: 'Read issues.',
  sensitivity: 'read',
  sensitive: false,
  requiredScope: [{permission: 'issues', access: 'read'}],
  inputSchema: {type: 'object'},
  methods: [
    {
      id: 'get',
      description: 'Get an issue.',
      sensitivity: 'read',
      sensitive: false,
      requiredScope: [{permission: 'issues', access: 'read'}],
    },
    {
      id: 'get_comments',
      description: 'Get issue comments.',
      sensitivity: 'read',
      sensitive: false,
      requiredScope: [{permission: 'issues', access: 'read'}],
    },
  ],
};
const issueWrite: AgentToolCatalogEntry = {
  id: 'issue_write',
  description: 'Write issues.',
  sensitivity: 'write',
  sensitive: true,
  requiredScope: [{permission: 'issues', access: 'write'}],
  inputSchema: {type: 'object'},
  methods: [
    {
      id: 'create',
      description: 'Create an issue.',
      sensitivity: 'write',
      sensitive: true,
      requiredScope: [{permission: 'issues', access: 'write'}],
    },
  ],
};
const downloadFile: AgentToolCatalogEntry = {
  id: 'download_file',
  description: 'Download a file.',
  sensitivity: 'read',
  sensitive: false,
  requiredScope: ['files:read'],
  result: 'file',
  inputSchema: {type: 'object', properties: {url: {type: 'string'}}},
  outputSchema: {type: 'object'},
};

function context(overrides: Partial<ResolveAgentToolsContext> = {}): ResolveAgentToolsContext {
  return {
    catalogs: new Map([
      ['github', [issueRead, issueWrite, downloadFile]],
      ['slack', [downloadFile]],
    ]),
    workspaceConnections: new Map([
      ['github-main', {id: 'connection-1', provider: 'github', capabilities: ['agent_tools']}],
      ['team-slack', {id: 'connection-2', provider: 'slack', capabilities: ['agent_tools']}],
      ['source-only', {id: 'connection-3', provider: 'gitea', capabilities: ['source_control']}],
    ]),
    defaultConnection: {id: 'connection-1', slug: 'github-main', provider: 'github'},
    ...overrides,
  };
}

function failure(run: () => unknown): AgentToolsSelectionError {
  try {
    run();
  } catch (error) {
    if (error instanceof AgentToolsSelectionError) return error;
    throw error;
  }
  throw new Error('Expected a selection failure');
}

describe('resolveAgentToolsGrant', () => {
  it('grants every method of a family and keeps the tool order of the catalog', () => {
    const grant = resolveAgentToolsGrant({
      selection: {include: ['download_file', 'issue_read']},
      context: context(),
    });

    expect(grant).toMatchObject({
      connectionId: 'connection-1',
      connectionSlug: 'github-main',
      provider: 'github',
      // A permission scope next to a plain scope stays as authored.
      requiredScope: [{permission: 'issues', access: 'read'}, 'files:read'],
    });
    expect(grant.tools.map((tool) => tool.id)).toEqual(['issue_read', 'download_file']);
    expect(grant.tools[0]?.methods?.map((method) => method.token)).toEqual([
      'issue_read.get',
      'issue_read.get_comments',
    ]);
  });

  it('grants one method with its description and scope', () => {
    const grant = resolveAgentToolsGrant({
      selection: {include: ['issue_read.get']},
      context: context(),
    });

    expect(grant.tools).toEqual([
      {
        id: 'issue_read',
        description: 'Read issues.',
        sensitivity: 'read',
        sensitive: false,
        requiredScope: [{permission: 'issues', access: 'read'}],
        inputSchema: {type: 'object'},
        result: 'json',
        methods: [
          {
            id: 'get',
            token: 'issue_read.get',
            description: 'Get an issue.',
            sensitivity: 'read',
            sensitive: false,
            requiredScope: [{permission: 'issues', access: 'read'}],
          },
        ],
      },
    ]);
  });

  it('subtracts what exclude names', () => {
    const grant = resolveAgentToolsGrant({
      selection: {
        include: ['issue_read', 'issue_write', 'download_file'],
        exclude: ['issue_read.get_comments', 'issue_write', 'download_file'],
      },
      context: context(),
    });

    expect(grant.tools).toHaveLength(1);
    expect(grant.tools[0]?.methods?.map((method) => method.id)).toEqual(['get']);
  });

  it('expands a family wildcard to every method', () => {
    const grant = resolveAgentToolsGrant({
      selection: {include: ['issue_read.*']},
      context: context(),
    });

    expect(grant.tools[0]?.methods).toHaveLength(2);
  });

  it('reports the result kind and output schema of a standalone tool', () => {
    const grant = resolveAgentToolsGrant({
      selection: {connection: 'team-slack', include: ['download_file']},
      context: context(),
    });

    expect(grant.tools[0]).toMatchObject({
      result: 'file',
      outputSchema: {type: 'object'},
      requiredScope: ['files:read'],
    });
    expect(grant.tools[0]?.methods).toBeUndefined();
  });

  it('marks a family with a write method as a write tool', () => {
    const grant = resolveAgentToolsGrant({
      selection: {include: ['issue_read.get', 'issue_write.create']},
      context: context(),
    });

    expect(grant.tools.map((tool) => [tool.id, tool.sensitivity])).toEqual([
      ['issue_read', 'read'],
      ['issue_write', 'write'],
    ]);
    expect(grant.requiredScope).toEqual([{permission: 'issues', access: 'write'}]);
  });

  it('refuses a selector that names no tool, so every granted tool is named', () => {
    const error = failure(() =>
      resolveAgentToolsGrant({selection: {include: ['*']}, context: context()}),
    );

    expect(error.details).toEqual({reason: 'tool-unknown', connection: 'github-main', tool: '*'});
  });

  it('names an unknown tool and the connection it was looked up on', () => {
    const error = failure(() =>
      resolveAgentToolsGrant({
        selection: {include: ['missing']},
        context: context(),
      }),
    );

    expect(error.details).toEqual({
      reason: 'tool-unknown',
      connection: 'github-main',
      tool: 'missing',
    });
  });

  it('names an unknown method of a known family', () => {
    const error = failure(() =>
      resolveAgentToolsGrant({
        selection: {include: ['issue_read.missing']},
        context: context(),
      }),
    );

    expect(error.details).toMatchObject({reason: 'tool-unknown', tool: 'issue_read.missing'});
  });

  it('reports a selection that resolves to no tools', () => {
    const error = failure(() =>
      resolveAgentToolsGrant({
        selection: {include: ['issue_read.get'], exclude: ['issue_read.get']},
        context: context(),
      }),
    );

    expect(error.details).toEqual({reason: 'no-tools-selected', connection: 'github-main'});
  });

  it('names a connection that is not in the workspace', () => {
    const error = failure(() =>
      resolveAgentToolsGrant({
        selection: {connection: 'removed', include: ['issue_read']},
        context: context(),
      }),
    );

    expect(error.details).toEqual({reason: 'connection-missing', connection: 'removed'});
  });

  it('refuses a connection of another provider than the one required', () => {
    const error = failure(() =>
      resolveAgentToolsGrant({
        selection: {
          connection: 'github-main',
          provider: 'slack',
          include: ['download_file'],
        },
        context: context(),
      }),
    );

    expect(error.details).toEqual({
      reason: 'connection-provider-mismatch',
      connection: 'github-main',
    });
  });

  it('asks for a named connection when the project has no default', () => {
    const error = failure(() =>
      resolveAgentToolsGrant({
        selection: {include: ['issue_read']},
        context: context({defaultConnection: null}),
      }),
    );

    expect(error.details).toEqual({reason: 'source-connection-missing'});
    expect(error.message).toContain('Name a `connection`');
  });

  it('uses a named connection when the project has no default', () => {
    const grant = resolveAgentToolsGrant({
      selection: {connection: 'team-slack', include: ['download_file']},
      context: context({defaultConnection: null}),
    });

    expect(grant.connectionSlug).toBe('team-slack');
  });

  it('leaves the reason out when the provider has no agent tool catalog', () => {
    const error = failure(() =>
      resolveAgentToolsGrant({
        selection: {connection: 'source-only', include: ['issue_read']},
        context: context(),
      }),
    );

    expect(error.message).toBe('Integration provider gitea has no agent tool catalog');
    expect(error.details.reason).toBeUndefined();
  });
});
