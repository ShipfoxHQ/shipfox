import {fileURLToPath} from 'node:url';
import type {MaterializedAgentMcpServerConfigDto} from '@shipfox/api-agent-dto';
import {localExecutionHost} from '@shipfox/runner-container';
import {
  type CustomMcpServers,
  CustomMcpServerUnavailableError,
  startCustomMcpServers,
} from '#core/custom-mcp-servers.js';

const FAKE_SERVER = fileURLToPath(new URL('./fixtures/fake-stdio-mcp-server.sh', import.meta.url));

function server(
  overrides: Partial<MaterializedAgentMcpServerConfigDto> = {},
): MaterializedAgentMcpServerConfigDto {
  return {name: 'fake', command: 'sh', args: [FAKE_SERVER], env: {}, ...overrides};
}

function start(params: Partial<Parameters<typeof startCustomMcpServers>[0]> = {}) {
  return startCustomMcpServers({
    servers: [server()],
    host: localExecutionHost,
    cwd: process.cwd(),
    baseEnv: {PATH: process.env.PATH ?? ''},
    redactions: [],
    reservedToolNames: new Set(),
    ...params,
  });
}

describe('startCustomMcpServers', () => {
  let servers: CustomMcpServers | undefined;

  afterEach(async () => {
    await servers?.close();
    servers = undefined;
  });

  it('lists each server tool under the server name and calls it with the server env', async () => {
    servers = await start({
      servers: [server({env: {FAKE_SECRET: 'literal'}}), server({name: 'other'})],
      secretEnv: {other: {FAKE_SECRET: 'from-a-secret'}},
    });

    const result = await servers.callTool({name: 'other__secret_length', arguments: {}});

    expect(servers.tools.map((tool) => tool.name)).toEqual([
      'fake__secret_length',
      'fake__crash',
      'other__secret_length',
      'other__crash',
    ]);
    expect(servers.requestedTools).toContainEqual({connectionSlug: 'fake', toolId: 'crash'});
    expect(result.content).toEqual([{type: 'text', text: 'length:13'}]);
  });

  it('keeps only the included tools', async () => {
    servers = await start({servers: [server({include: ['secret_length']})]});

    expect(servers.tools.map((tool) => tool.name)).toEqual(['fake__secret_length']);
    expect(servers.has('fake__crash')).toBe(false);
  });

  it('fails when an included tool is not listed', async () => {
    const started = start({servers: [server({include: ['secret_length', 'drop_table']})]});

    await expect(started).rejects.toThrow(
      'MCP server "fake" does not list the included tools: drop_table.',
    );
  });

  it('fails with the redacted stderr of a server that exits before it answers', async () => {
    const started = start({
      servers: [server({env: {FAKE_STDERR: 'bad token hunter2', FAKE_EXIT_CODE: '1'}})],
      redactions: ['hunter2'],
    });

    await expect(started).rejects.toThrow(CustomMcpServerUnavailableError);
    await expect(started).rejects.toThrow(
      'MCP server "fake" did not start: exited with code 1. stderr: bad token ***',
    );
  });

  it('fails when the command does not exist', async () => {
    const started = start({servers: [server({command: 'shipfox-missing-mcp-server', args: []})]});

    await expect(started).rejects.toThrow('MCP server "fake" did not start');
  });

  it('fails a server that does not answer before the start timeout', async () => {
    const started = start({
      servers: [server({command: 'sleep', args: ['30']})],
      startTimeoutMs: 200,
    });

    await expect(started).rejects.toThrow(
      'MCP server "fake" did not start: it did not answer within 0.2 seconds.',
    );
  });

  it('fails a tool whose Claude name would pass 64 characters', async () => {
    const started = start({
      servers: [
        server({
          env: {
            FAKE_TOOLS:
              '{"name":"atlas-inspect-access-list-entries-for-project","inputSchema":{"type":"object"}}',
          },
        }),
      ],
    });

    await expect(started).rejects.toThrow(
      'as "mcp__shipfox__fake__atlas-inspect-access-list-entries-for-project" it must have at most 64',
    );
  });

  it('fails a tool name that an integration tool on the step already uses', async () => {
    const started = start({reservedToolNames: new Set(['fake__crash'])});

    await expect(started).rejects.toThrow('under a name that another tool on this step uses');
  });

  it('stops the servers that started when another one fails', async () => {
    const killed: string[] = [];
    const host = {
      ...localExecutionHost,
      spawn: (request: Parameters<typeof localExecutionHost.spawn>[0]) => {
        const child = localExecutionHost.spawn(request);
        return {
          ...child,
          killTree: async () => {
            killed.push(request.env.FAKE_NAME ?? '');
            await child.killTree();
          },
        };
      },
    };

    const started = start({
      host,
      servers: [
        server({env: {FAKE_NAME: 'ok'}}),
        server({name: 'broken', env: {FAKE_NAME: 'broken', FAKE_EXIT_CODE: '2'}}),
      ],
    });

    await expect(started).rejects.toThrow('MCP server "broken" did not start');
    expect(killed).toContain('ok');
  });

  it('returns an error result for calls after the server exits', async () => {
    servers = await start();

    const crash = await servers.callTool({name: 'fake__crash', arguments: {}});
    const after = await servers.callTool({name: 'fake__secret_length', arguments: {}});

    expect(crash).toEqual({
      isError: true,
      content: [{type: 'text', text: 'MCP server fake exited with code 3.'}],
    });
    expect(after.isError).toBe(true);
  });
});
