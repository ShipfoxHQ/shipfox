import type {AgentToolCatalogEntry} from '@shipfox/api-integration-spi';
import {type ProviderToolCatalog, providerToolCatalogs} from '#catalogs.js';
import {
  isToolCatalogFileCurrent,
  renderToolCatalogSource,
  renderToolGrantsSource,
} from '#generate.js';

const readThread: AgentToolCatalogEntry = {
  id: 'read_thread',
  description: 'Read a thread. Ends with */ on purpose.',
  sensitivity: 'read',
  sensitive: false,
  requiredScope: null,
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      channel_id: {type: 'string', title: 'Channel'},
      cursor: {type: 'string'},
    },
    required: ['channel_id'],
  },
};

const issueRead: AgentToolCatalogEntry = {
  id: 'issue_read',
  description: 'Read an issue.',
  sensitivity: 'read',
  sensitive: false,
  requiredScope: null,
  result: 'file',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      method: {type: 'string', enum: ['get', 'get_comments']},
      issue_number: {type: 'integer'},
    },
    required: ['method', 'issue_number'],
  },
  methods: [
    {
      id: 'get',
      description: 'Get the issue.',
      sensitivity: 'read',
      sensitive: false,
      requiredScope: null,
    },
  ],
};

describe('renderToolCatalogSource', () => {
  it('maps tool ids and family methods to argument types and result kinds', async () => {
    const source = await renderToolCatalogSource([
      {provider: 'slack', tools: [readThread]},
      {provider: 'github', tools: [issueRead]},
    ]);

    expect(source).toContain(
      "'issue_read.get': {arguments: GithubIssueReadGetArguments; result: 'file'; structured: unknown};",
    );
    expect(source).toContain(
      "read_thread: {arguments: SlackReadThreadArguments; result: 'json'; structured: unknown};",
    );
    expect(source).toContain('Ends with *\\/ on purpose.');
    expect(source.indexOf('github: {')).toBeLessThan(source.indexOf('slack: {'));
  });

  it('types the structured result from the output schema, once per family', async () => {
    const pullRequestRead: AgentToolCatalogEntry = {
      ...issueRead,
      id: 'pull_request_read',
      result: 'json',
      outputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {number: {type: 'integer'}, title: {type: 'string'}},
        required: ['number'],
      },
    };

    const source = await renderToolCatalogSource([{provider: 'github', tools: [pullRequestRead]}]);

    expect(source).toContain('structured: GithubPullRequestReadResult;\n    };\n    /**');
    expect(source).toContain("result: 'json';\n      structured: GithubPullRequestReadResult;");
    expect(source.split('export interface GithubPullRequestReadResult {')).toHaveLength(2);
    expect(declaration(source, 'GithubPullRequestReadResult')).toBe(
      'export interface GithubPullRequestReadResult {\n  number: number;\n  title?: string;\n}',
    );
  });

  it('leaves the structured result of a file tool unknown', async () => {
    const source = await renderToolCatalogSource([
      {provider: 'github', tools: [{...issueRead, outputSchema: {type: 'object'}}]},
    ]);

    expect(source).not.toContain('GithubIssueReadResult');
  });

  it('drops the method argument from family methods only', async () => {
    const source = await renderToolCatalogSource([{provider: 'github', tools: [issueRead]}]);

    expect(declaration(source, 'GithubIssueReadArguments')).toContain(
      "method: 'get' | 'get_comments';",
    );
    expect(declaration(source, 'GithubIssueReadGetArguments')).toBe(
      'export interface GithubIssueReadGetArguments {\n  issue_number: number;\n}',
    );
  });

  it('requires the fields of the matching method branch', async () => {
    const checkRunWrite: AgentToolCatalogEntry = {
      ...issueRead,
      id: 'check_run_write',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          method: {type: 'string', enum: ['create', 'update']},
          check_run_id: {type: 'integer'},
          name: {type: 'string'},
        },
        required: ['method'],
        oneOf: [
          {properties: {method: {const: 'create'}}, required: ['name']},
          {properties: {method: {const: 'update'}}, required: ['check_run_id']},
        ],
      },
      methods: [
        {
          id: 'create',
          description: 'Create a check run.',
          sensitivity: 'write',
          sensitive: false,
          requiredScope: null,
        },
      ],
    };

    const source = await renderToolCatalogSource([{provider: 'github', tools: [checkRunWrite]}]);

    expect(declaration(source, 'GithubCheckRunWriteCreateArguments')).toBe(
      'export interface GithubCheckRunWriteCreateArguments {\n  check_run_id?: number;\n  name: string;\n}',
    );
  });

  it('inlines titled subschemas instead of naming them', async () => {
    const source = await renderToolCatalogSource([{provider: 'slack', tools: [readThread]}]);

    expect(declaration(source, 'SlackReadThreadArguments')).toBe(
      'export interface SlackReadThreadArguments {\n  channel_id: string;\n  cursor?: string;\n}',
    );
    expect(source).not.toContain('Channel');
  });

  it('rejects two tools that generate the same type name', async () => {
    const catalog: ProviderToolCatalog = {
      provider: 'slack',
      tools: [readThread, {...readThread, id: 'read-thread'}],
    };

    await expect(renderToolCatalogSource([catalog])).rejects.toThrow(
      'Two tools generate the type name SlackReadThreadArguments.',
    );
  });
});

describe('renderToolGrantsSource', () => {
  it('lists the sensitivity and result kind of every tool and family method', () => {
    const source = renderToolGrantsSource([
      {provider: 'slack', tools: [readThread]},
      {provider: 'github', tools: [issueRead]},
    ]);

    expect(source).toContain(
      [
        "  github: {issue_read: {sensitivity: 'read', result: 'file', methods: {get: 'read'}}},",
        "  slack: {read_thread: {sensitivity: 'read', result: 'json'}},",
      ].join('\n'),
    );
  });
});

describe('isToolCatalogFileCurrent', () => {
  it('matches the committed file to the provider catalogs', async () => {
    const current = await isToolCatalogFileCurrent(providerToolCatalogs);

    expect(current, 'Run `pnpm --filter @shipfox/action-tool-types generate`.').toBe(true);
  });

  it('reports drift when only a sensitivity changes', async () => {
    const changed = providerToolCatalogs.map((catalog) => ({
      ...catalog,
      tools: catalog.tools.map((tool) => ({
        ...tool,
        sensitivity: tool.sensitivity === 'read' ? ('write' as const) : ('read' as const),
      })),
    }));

    const current = await isToolCatalogFileCurrent(changed);

    expect(current).toBe(false);
  });

  it('reports drift when a catalog changes', async () => {
    const changed = providerToolCatalogs.map((catalog) =>
      catalog.provider === 'slack'
        ? {...catalog, tools: [...catalog.tools, {...readThread, id: 'read_thread_export'}]}
        : catalog,
    );

    const current = await isToolCatalogFileCurrent(changed);

    expect(current).toBe(false);
  });
});

function declaration(source: string, name: string): string {
  const start = source.indexOf(`export interface ${name} {`);
  return source.slice(start, source.indexOf('\n}', start) + 2);
}
