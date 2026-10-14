import {once} from 'node:events';
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {createServer, type Server as HttpServer} from 'node:http';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {ExtensionAPI, ExtensionContext} from '@earendil-works/pi-coding-agent';
import {Server} from '@modelcontextprotocol/sdk/server/index.js';
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type {Transport} from '@modelcontextprotocol/sdk/shared/transport.js';
import {CallToolRequestSchema, ListToolsRequestSchema} from '@modelcontextprotocol/sdk/types.js';

const PI_MCP_ADAPTER_ENTRYPOINT = 'pi-mcp-adapter/index.ts';
const PI_MCP_METADATA_CACHE_ENTRYPOINT = 'pi-mcp-adapter/metadata-cache.ts';
const PI_MCP_CONFIG_ENTRYPOINT = 'pi-mcp-adapter/config.ts';

describe('pi-mcp-adapter contract', () => {
  let workspace: string | undefined;
  let gateway: FakeMcpGateway | undefined;
  const originalAgentDirectory = process.env.PI_CODING_AGENT_DIR;
  const originalHome = process.env.HOME;
  const originalArgv = process.argv.slice();

  afterEach(async () => {
    if (originalAgentDirectory === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = originalAgentDirectory;
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    vi.resetModules();
    process.argv.splice(0, process.argv.length, ...originalArgv);
    await gateway?.close();
    gateway = undefined;
    if (workspace !== undefined) await rm(workspace, {recursive: true, force: true});
    workspace = undefined;
  });

  it('registers and invokes a cached direct tool with object arguments', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'shipfox-pi-mcp-contract-'));
    gateway = await startFakeMcpGateway();
    const definition = {
      url: gateway.url.toString(),
      auth: false,
      lifecycle: 'eager',
      directTools: true,
      exposeResources: false,
    };
    const {default: mcpAdapter} = (await import(PI_MCP_ADAPTER_ENTRYPOINT)) as PiMcpAdapterModule;
    const {computeServerHash} = (await import(
      PI_MCP_METADATA_CACHE_ENTRYPOINT
    )) as PiMcpMetadataCacheModule;
    const tool = {
      name: 'linear_main__get_issue',
      description: 'Read a Linear issue.',
      inputSchema: {type: 'object', properties: {id: {type: 'string'}}},
    };
    const configPath = join(workspace, 'mcp.json');
    await writeFile(
      configPath,
      JSON.stringify({
        settings: {toolPrefix: 'none'},
        mcpServers: {shipfox_integration_tools: definition},
      }),
    );
    await writeFile(
      join(workspace, 'mcp-cache.json'),
      JSON.stringify({
        version: 1,
        servers: {
          shipfox_integration_tools: {
            configHash: computeServerHash(definition),
            tools: [tool],
            resources: [],
            cachedAt: Date.now(),
          },
        },
      }),
    );
    process.env.PI_CODING_AGENT_DIR = workspace;
    process.argv.splice(0, process.argv.length, 'node', 'pi', '--mcp-config', configPath);

    const registeredTools: RegisteredTool[] = [];
    const eventHandlers = new Map<string, (...args: unknown[]) => unknown>();
    const extensionApi = {
      registerTool: (registeredTool: RegisteredTool) => registeredTools.push(registeredTool),
      registerFlag: () => undefined,
      getFlag: (name: string) => (name === 'mcp-config' ? configPath : undefined),
      registerCommand: () => undefined,
      on: (event: string, handler: (...args: unknown[]) => unknown) =>
        eventHandlers.set(event, handler),
      getAllTools: () => registeredTools,
    } as unknown as ExtensionAPI;
    const signal = new AbortController().signal;
    const context = {
      cwd: workspace,
      hasUI: false,
      mode: 'print',
      signal,
    } as unknown as ExtensionContext;

    mcpAdapter(extensionApi);
    const directTool = registeredTools.find((registeredTool) => registeredTool.name === tool.name);
    expect(directTool).toBeDefined();
    if (directTool === undefined) return;

    await eventHandlers.get('session_start')?.({}, context);
    const result = await directTool.execute('call-1', {id: 'ENG-1857'}, signal, undefined, context);
    await eventHandlers.get('session_shutdown')?.({}, context);

    expect(gateway.calls).toEqual([{name: tool.name, arguments: {id: 'ENG-1857'}}]);
    expect(result.content).toEqual([{type: 'text', text: 'called'}]);
  });

  it('reads only the override file and ignores repository and user MCP config', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'shipfox-pi-mcp-sources-'));
    const home = join(workspace, 'home');
    const repository = join(workspace, 'repository');
    await mkdir(join(home, '.config', 'mcp'), {recursive: true});
    await mkdir(join(repository, '.pi'), {recursive: true});
    const managed = {url: 'http://127.0.0.1:1/managed', auth: false};
    const hijacked = {url: 'http://attacker.invalid/mcp', auth: false};
    const configPath = join(workspace, 'mcp.json');
    await writeFile(configPath, JSON.stringify({mcpServers: {shipfox_integration_tools: managed}}));
    await writeFile(
      join(repository, '.mcp.json'),
      JSON.stringify({mcpServers: {shipfox_integration_tools: hijacked, repo_server: hijacked}}),
    );
    await writeFile(
      join(repository, '.pi', 'mcp.json'),
      JSON.stringify({mcpServers: {shipfox_integration_tools: hijacked, pi_repo_server: hijacked}}),
    );
    await writeFile(
      join(home, '.config', 'mcp', 'mcp.json'),
      JSON.stringify({mcpServers: {runner_user_server: hijacked}}),
    );
    // The adapter resolves the user-level path from HOME when the module is evaluated.
    process.env.HOME = home;
    vi.resetModules();
    const {loadMcpConfig} = (await import(PI_MCP_CONFIG_ENTRYPOINT)) as PiMcpConfigModule;

    const config = loadMcpConfig(configPath, repository);

    expect(config.mcpServers).toEqual({shipfox_integration_tools: managed});
  });
});

interface PiMcpAdapterModule {
  readonly default: (extensionApi: ExtensionAPI) => void;
}

interface PiMcpConfigModule {
  readonly loadMcpConfig: (
    overridePath: string,
    cwd: string,
  ) => {readonly mcpServers: Record<string, unknown>};
}

interface PiMcpMetadataCacheModule {
  readonly computeServerHash: (definition: unknown) => string;
}

interface RegisteredTool {
  readonly name: string;
  readonly execute: (
    toolCallId: string,
    params: Record<string, unknown>,
    signal: AbortSignal,
    onUpdate: undefined,
    context: ExtensionContext,
  ) => Promise<{content: unknown[]}>;
}

interface FakeMcpGateway {
  readonly url: URL;
  readonly calls: Array<{name: string; arguments: Record<string, unknown> | undefined}>;
  close(): Promise<void>;
}

async function startFakeMcpGateway(): Promise<FakeMcpGateway> {
  const calls: Array<{name: string; arguments: Record<string, unknown> | undefined}> = [];
  const httpServer = createServer(async (request, response) => {
    const body = await readJsonBody(request);
    const server = new Server(
      {name: 'fake-integration-tools', version: '0.0.0'},
      {capabilities: {tools: {}}},
    );
    const transport = new StreamableHTTPServerTransport();

    server.setRequestHandler(ListToolsRequestSchema, () => ({
      tools: [
        {
          name: 'linear_main__get_issue',
          description: 'Read a Linear issue.',
          inputSchema: {type: 'object', properties: {id: {type: 'string'}}},
        },
      ],
    }));
    server.setRequestHandler(CallToolRequestSchema, (toolRequest) => {
      calls.push({
        name: toolRequest.params.name,
        arguments: toolRequest.params.arguments,
      });
      return {content: [{type: 'text', text: 'called'}]};
    });

    await server.connect(transport as unknown as Transport);
    response.on('close', () => {
      void transport.close();
      void server.close();
    });
    await transport.handleRequest(request, response, body);
  });
  httpServer.listen(0, '127.0.0.1');
  await once(httpServer, 'listening');

  return {
    url: new URL('/mcp', address(httpServer)),
    calls,
    close: () =>
      new Promise<void>((resolve, reject) => {
        httpServer.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      }),
  };
}

function address(server: HttpServer): string {
  const addressInfo = server.address();
  if (typeof addressInfo !== 'object' || addressInfo === null) {
    throw new Error('Fake MCP gateway did not bind a TCP address.');
  }
  return `http://127.0.0.1:${addressInfo.port}`;
}

async function readJsonBody(request: NodeJS.ReadableStream): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const text = Buffer.concat(chunks).toString('utf8');
  return text === '' ? undefined : (JSON.parse(text) as unknown);
}
