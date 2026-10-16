const fauxState = vi.hoisted(() => ({
  provider: undefined as unknown,
}));

vi.mock('@earendil-works/pi-coding-agent', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@earendil-works/pi-coding-agent')>();
  return {
    ...actual,
    ModelRuntime: {
      create: async (options: Parameters<typeof actual.ModelRuntime.create>[0]) => {
        const runtime = await actual.ModelRuntime.create({...options, refreshOnCreate: false});
        runtime.registerNativeProvider(fauxState.provider as never);
        await runtime.refresh({allowNetwork: false});
        return runtime;
      },
    },
  };
});

import {once} from 'node:events';
import {mkdir, mkdtemp, readdir, readFile, rm, writeFile} from 'node:fs/promises';
import {createServer, type Server as HttpServer} from 'node:http';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {getCurrentTools} from '@earendil-works/pi-ai';
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from '@earendil-works/pi-ai/providers/faux';
import {Server} from '@modelcontextprotocol/sdk/server/index.js';
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type {Transport} from '@modelcontextprotocol/sdk/shared/transport.js';
import {CallToolRequestSchema, ListToolsRequestSchema} from '@modelcontextprotocol/sdk/types.js';
import {AGENT_TOOLS_MCP_SERVER_ID} from '@shipfox/api-agent-dto';
import {AGENT_SESSION_DIAGNOSTICS_ENTRY_TYPE} from '#core/agent-session-diagnostics.js';
import type {HarnessInvocation, HarnessResult} from '#core/harness.js';
import {
  createIntegrationToolsBridge,
  type IntegrationToolsBridge,
} from '#core/integration-tools-bridge.js';
import {piHarnessAdapter} from '#core/pi-adapter.js';

const FAUX_PROVIDER = 'mcp-contract';
const FAUX_MODEL = 'mcp-contract-model';
const INTEGRATION_TOOL = 'linear_main__get_issue';
// Over 50 characters, so Pi shortens `mcp__shipfox__<tool>` with a hash suffix.
const LONG_INTEGRATION_TOOL = 'linear_main__get_issue_with_comments_attachments_and_full_history';
const TOOL_PREFIX = `mcp__${AGENT_TOOLS_MCP_SERVER_ID}__`;

describe('Pi built-in MCP contract', () => {
  const originalHome = process.env.HOME;
  let root: string | undefined;
  let gateway: FakeMcpServer | undefined;
  let decoy: FakeMcpServer | undefined;
  let bridge: IntegrationToolsBridge | undefined;

  afterEach(async () => {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    await bridge?.close();
    await gateway?.close();
    await decoy?.close();
    if (root !== undefined) await rm(root, {recursive: true, force: true});
    bridge = undefined;
    gateway = undefined;
    decoy = undefined;
    root = undefined;
  });

  async function runContract(params: {
    toolName: string;
    invocation?: Partial<HarnessInvocation>;
  }): Promise<{result: HarnessResult; declaredTools: string[]; agentStateDir: string}> {
    root = await mkdtemp(join(tmpdir(), 'shipfox-pi-mcp-contract-'));
    gateway = await startFakeMcpServer(params.toolName);
    decoy = await startFakeMcpServer('decoy_tool');
    const workspace = join(root, 'workspace');
    const home = join(root, 'home');
    const agentStateDir = join(root, 'agent-state');
    const decoyConfig = JSON.stringify({
      mcpServers: {
        [AGENT_TOOLS_MCP_SERVER_ID]: {url: decoy.url.toString()},
        repository_server: {url: decoy.url.toString()},
      },
    });
    await writeConfig(join(workspace, '.mcp.json'), decoyConfig);
    await writeConfig(join(workspace, '.pi', 'mcp.json'), decoyConfig);
    await writeConfig(join(home, '.pi', 'agent', 'mcp.json'), decoyConfig);
    await writeConfig(join(home, '.config', 'mcp', 'mcp.json'), decoyConfig);
    process.env.HOME = home;

    let declaredTools: string[] = [];
    const faux = fauxProvider({provider: FAUX_PROVIDER, models: [{id: FAUX_MODEL}]});
    faux.setResponses([
      (context) => {
        declaredTools = getCurrentTools(context.messages).map((tool) => tool.name);
        const exposedName = declaredTools.find((name) => name.startsWith(TOOL_PREFIX)) ?? '';
        return fauxAssistantMessage(fauxToolCall(exposedName, {id: 'ENG-3093'}), {
          stopReason: 'toolUse',
        });
      },
      fauxAssistantMessage('done'),
    ]);
    fauxState.provider = faux.provider;
    bridge = createIntegrationToolsBridge({
      name: AGENT_TOOLS_MCP_SERVER_ID,
      gateway: {url: gateway.url, fetch},
    });

    const result = await piHarnessAdapter.run({
      cwd: workspace,
      agentStateDir,
      model: FAUX_MODEL,
      provider: FAUX_PROVIDER,
      thinking: 'default',
      prompt: 'Read ENG-3093.',
      credentials: {api_key: 'faux-key'},
      mcpServers: [bridge],
      toolSurface: 'discovery',
      signal: new AbortController().signal,
      ...params.invocation,
    });
    return {result, declaredTools, agentStateDir};
  }

  it('connects only runner-supplied servers and calls their tools', async () => {
    const {result, declaredTools} = await runContract({toolName: INTEGRATION_TOOL});

    expect(result.response).toBe('done');
    expect(declaredTools).toContain(`${TOOL_PREFIX}${INTEGRATION_TOOL}`);
    expect(declaredTools.some((name) => name.includes('decoy'))).toBe(false);
    expect(gateway?.calls).toEqual([{name: INTEGRATION_TOOL, arguments: {id: 'ENG-3093'}}]);
    expect(decoy?.requests).toBe(0);
  });

  it('keeps a shortened tool name with selected Pi tools and satisfies its prerequisite', async () => {
    const {result, declaredTools, agentStateDir} = await runContract({
      toolName: LONG_INTEGRATION_TOOL,
      invocation: {
        tools: ['read'],
        prerequisites: {required: [LONG_INTEGRATION_TOOL]},
      },
    });

    const exposedName = declaredTools.find((name) => name.startsWith(TOOL_PREFIX));
    // The met prerequisite ends the run after the tool turn, before the final text.
    expect(result.response).toBe('');
    expect(declaredTools).toContain('read');
    expect(exposedName).toHaveLength(64);
    expect(gateway?.calls).toEqual([{name: LONG_INTEGRATION_TOOL, arguments: {id: 'ENG-3093'}}]);
    expect(await diagnosedDirectToolNames(agentStateDir)).toEqual([exposedName]);
  });
});

async function diagnosedDirectToolNames(agentStateDir: string): Promise<unknown> {
  const sessionsDir = join(agentStateDir, 'agent-sessions');
  for (const file of await readdir(sessionsDir, {recursive: true})) {
    if (!file.endsWith('.jsonl')) continue;
    for (const line of (await readFile(join(sessionsDir, file), 'utf8')).split('\n')) {
      if (!line.includes(AGENT_SESSION_DIAGNOSTICS_ENTRY_TYPE)) continue;
      const entry = JSON.parse(line) as {data?: {registration?: {directToolNames?: unknown}}};
      return entry.data?.registration?.directToolNames;
    }
  }
  return undefined;
}

async function writeConfig(path: string, content: string): Promise<void> {
  await mkdir(join(path, '..'), {recursive: true});
  await writeFile(path, content);
}

interface FakeMcpServer {
  readonly url: URL;
  readonly calls: Array<{name: string; arguments: Record<string, unknown> | undefined}>;
  readonly requests: number;
  close(): Promise<void>;
}

async function startFakeMcpServer(toolName: string): Promise<FakeMcpServer> {
  const calls: FakeMcpServer['calls'] = [];
  let requests = 0;
  const httpServer = createServer(async (request, response) => {
    requests += 1;
    const body = await readJsonBody(request);
    const server = new Server({name: 'fake-mcp', version: '0.0.0'}, {capabilities: {tools: {}}});
    const transport = new StreamableHTTPServerTransport();
    server.setRequestHandler(ListToolsRequestSchema, () => ({
      tools: [{name: toolName, inputSchema: {type: 'object', properties: {id: {type: 'string'}}}}],
    }));
    server.setRequestHandler(CallToolRequestSchema, (toolRequest) => {
      calls.push({name: toolRequest.params.name, arguments: toolRequest.params.arguments});
      return {content: [{type: 'text', text: 'issue'}]};
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
    get requests() {
      return requests;
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        httpServer.closeAllConnections();
        httpServer.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

function address(server: HttpServer): string {
  const addressInfo = server.address();
  if (typeof addressInfo !== 'object' || addressInfo === null) {
    throw new Error('Fake MCP server did not bind a TCP address.');
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
