import type {AgentToolCatalogEntry} from '@shipfox/api-integration-spi';
import {type ProviderToolCatalog, providerToolCatalogs} from '#catalogs.js';
import {isToolCatalogFileCurrent, renderToolCatalogSource} from '#generate.js';

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
      "'issue_read.get': {arguments: GithubIssueReadGetArguments; result: 'file'};",
    );
    expect(source).toContain("read_thread: {arguments: SlackReadThreadArguments; result: 'json'};");
    expect(source).toContain('Ends with *\\/ on purpose.');
    expect(source.indexOf('github: {')).toBeLessThan(source.indexOf('slack: {'));
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

describe('isToolCatalogFileCurrent', () => {
  it('matches the committed file to the provider catalogs', async () => {
    const current = await isToolCatalogFileCurrent(providerToolCatalogs);

    expect(current, 'Run `pnpm --filter @shipfox/action-tool-types generate`.').toBe(true);
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
