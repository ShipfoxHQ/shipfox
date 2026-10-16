import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type {RequestOptions} from '@modelcontextprotocol/sdk/shared/protocol.js';
import {ReadBuffer, serializeMessage} from '@modelcontextprotocol/sdk/shared/stdio.js';
import type {Transport} from '@modelcontextprotocol/sdk/shared/transport.js';
import {
  type CallToolRequest,
  type CallToolResult,
  CallToolResultSchema,
  type JSONRPCMessage,
  McpError,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';
import {
  AGENT_TOOLS_MCP_SERVER_ID,
  type MaterializedAgentHttpMcpServerConfigDto,
  type MaterializedAgentMcpServerConfigDto,
  type MaterializedAgentStdioMcpServerConfigDto,
} from '@shipfox/api-agent-dto';
import {logger} from '@shipfox/node-opentelemetry';
import type {ExecutionHost, HostProcess, HostProcessExit} from '@shipfox/runner-container';
import {redactSecrets} from '@shipfox/runner-workspace';
import type {RequestedIntegrationTool} from '#core/harness.js';

// Leaves room for a cold `npx` download before the server answers.
export const CUSTOM_MCP_SERVER_START_TIMEOUT_MS = 120_000;
const STDERR_TAIL_BYTES = 4 * 1024;
// An HTTP error message carries the response body, which can be a whole error page.
const HTTP_ERROR_BYTES = 4 * 1024;
const CLOSE_GRACE_MS = 2_000;
// Claude rejects tool names longer than 64 characters or with other characters.
const MAX_CLAUDE_TOOL_NAME_LENGTH = 64;
const TOOL_NAME_PATTERN = /^[A-Za-z0-9_-]+$/;

export class CustomMcpServerUnavailableError extends Error {
  constructor(
    readonly server: string,
    message: string,
  ) {
    super(message);
    this.name = 'CustomMcpServerUnavailableError';
  }
}

/** The started servers of one agent step, with their tools as the agent sees them. */
export interface CustomMcpServers {
  /** Each tool is named `<server>__<tool>`. */
  readonly tools: readonly Tool[];
  /** One entry per exposed tool, in the shape harnesses use to select integration tools. */
  readonly requestedTools: readonly RequestedIntegrationTool[];
  has(name: string): boolean;
  callTool(
    params: CallToolRequest['params'],
    options?: RequestOptions | undefined,
  ): Promise<CallToolResult>;
  close(): Promise<void>;
}

interface StartedServer {
  readonly name: string;
  readonly client: Client;
  tools: readonly Tool[];
  /** Why later calls fail, once a stdio server has exited. */
  readonly ended: () => string | undefined;
  /** The result the agent gets for a failed call, or `undefined` to pass the error on. */
  readonly failedCall: (error: unknown) => CallToolResult | undefined;
  readonly stop: () => Promise<void>;
}

/**
 * Starts every `command` server and connects to every `url` server in parallel, and lists their
 * tools. A server that fails to answer, lacks an included tool, or reports a tool the harness
 * cannot name fails the whole set, and the servers that did start are stopped.
 */
export async function startCustomMcpServers(params: {
  servers: readonly MaterializedAgentMcpServerConfigDto[];
  /** Env values that read secrets, by server name. */
  secretEnv?: Readonly<Record<string, Readonly<Record<string, string>>>> | undefined;
  /** Header values that read secrets, by server name. */
  secretHeaders?: Readonly<Record<string, Readonly<Record<string, string>>>> | undefined;
  host: ExecutionHost;
  cwd: string;
  baseEnv: Readonly<Record<string, string>>;
  /** Secret forms to mask in server stderr. */
  redactions: readonly string[];
  /** Exposed names of the gateway tools on the same bridge. */
  reservedToolNames: ReadonlySet<string>;
  signal?: AbortSignal | undefined;
  startTimeoutMs?: number | undefined;
}): Promise<CustomMcpServers> {
  const results = await Promise.allSettled(
    params.servers.map((server) =>
      'url' in server
        ? connectHttpServer({
            ...params,
            server,
            headers: {...server.headers, ...params.secretHeaders?.[server.name]},
          })
        : startStdioServer({
            ...params,
            server,
            env: {...params.baseEnv, ...server.env, ...params.secretEnv?.[server.name]},
          }),
    ),
  );
  const started = results.flatMap((result) =>
    result.status === 'fulfilled' ? [result.value] : [],
  );
  const failure = results.find((result) => result.status === 'rejected');
  if (failure !== undefined) {
    await stopServers(started);
    throw failure.reason;
  }

  try {
    return customMcpServers(started, params.reservedToolNames, params.servers);
  } catch (error) {
    await stopServers(started);
    throw error;
  }
}

function customMcpServers(
  started: readonly StartedServer[],
  reservedToolNames: ReadonlySet<string>,
  configs: readonly MaterializedAgentMcpServerConfigDto[],
): CustomMcpServers {
  const byExposedName = new Map<string, {server: StartedServer; tool: string}>();
  const tools: Tool[] = [];
  const requestedTools: RequestedIntegrationTool[] = [];
  for (const server of started) {
    const include = configs.find((config) => config.name === server.name)?.include;
    for (const tool of selectTools(server, include)) {
      const exposedName = `${server.name}__${tool.name}`;
      if (byExposedName.has(exposedName) || reservedToolNames.has(exposedName)) {
        throw new CustomMcpServerUnavailableError(
          server.name,
          `MCP server "${server.name}" lists the tool "${tool.name}" twice or under a name that another tool on this step uses.`,
        );
      }
      byExposedName.set(exposedName, {server, tool: tool.name});
      tools.push({...tool, name: exposedName});
      requestedTools.push({connectionSlug: server.name, toolId: tool.name});
    }
  }

  let closePromise: Promise<void> | undefined;
  return {
    tools,
    requestedTools,
    has: (name) => byExposedName.has(name),
    async callTool(params, options) {
      const target = byExposedName.get(params.name);
      if (target === undefined) throw new Error(`Unknown MCP tool "${params.name}".`);
      const {server} = target;
      const ended = server.ended();
      if (ended !== undefined) return endedServerResult(server.name, ended);
      try {
        return (await server.client.callTool(
          {...params, name: target.tool},
          CallToolResultSchema,
          options,
        )) as CallToolResult;
      } catch (error) {
        const result = server.failedCall(error);
        if (result !== undefined) return result;
        throw error;
      }
    },
    close() {
      closePromise ??= stopServers(started);
      return closePromise;
    },
  };
}

function selectTools(server: StartedServer, include: readonly string[] | undefined): Tool[] {
  const selected =
    include === undefined
      ? [...server.tools]
      : server.tools.filter((tool) => include.includes(tool.name));
  if (include !== undefined) {
    const listed = new Set(server.tools.map((tool) => tool.name));
    const missing = include.filter((name) => !listed.has(name));
    if (missing.length > 0) {
      throw new CustomMcpServerUnavailableError(
        server.name,
        `MCP server "${server.name}" does not list the included tools: ${missing.join(', ')}.`,
      );
    }
  }
  for (const tool of selected) {
    const claudeName = `mcp__${AGENT_TOOLS_MCP_SERVER_ID}__${server.name}__${tool.name}`;
    if (TOOL_NAME_PATTERN.test(tool.name) && claudeName.length <= MAX_CLAUDE_TOOL_NAME_LENGTH) {
      continue;
    }
    throw new CustomMcpServerUnavailableError(
      server.name,
      `MCP server "${server.name}" lists the tool "${tool.name}", which the agent cannot use: as "${claudeName}" it must have at most ${MAX_CLAUDE_TOOL_NAME_LENGTH} letters, numbers, underscores, or hyphens. Shorten the server name, or leave the tool out with "include".`,
    );
  }
  return selected;
}

function endedServerResult(server: string, ended: string): CallToolResult {
  return {isError: true, content: [{type: 'text', text: `MCP server ${server} ${ended}.`}]};
}

// Masks before it cuts, so a secret on the cut cannot leave an unmasked prefix.
function httpErrorDetail(error: unknown, redactions: readonly string[]): string {
  return redactSecrets(errorMessageWithCause(error), [...redactions]).slice(0, HTTP_ERROR_BYTES);
}

async function connectHttpServer(params: {
  server: MaterializedAgentHttpMcpServerConfigDto;
  headers: Readonly<Record<string, string>>;
  redactions: readonly string[];
  signal?: AbortSignal | undefined;
  startTimeoutMs?: number | undefined;
}): Promise<StartedServer> {
  const {server} = params;
  const startTimeoutMs = params.startTimeoutMs ?? CUSTOM_MCP_SERVER_START_TIMEOUT_MS;
  const client = new Client({name: 'shipfox-runner', version: '0.0.0'});
  const transport = new StreamableHTTPClientTransport(new URL(server.url), {
    requestInit: {headers: {...params.headers}},
  });
  const started: StartedServer = {
    name: server.name,
    client,
    tools: [],
    ended: () => undefined,
    // A server error is a protocol answer; anything else means the server could not be reached,
    // and its message can carry a whole response body.
    failedCall: (error) =>
      error instanceof McpError
        ? undefined
        : endedServerResult(
            server.name,
            `did not answer: ${httpErrorDetail(error, params.redactions)}`,
          ),
    stop: () => stopHttpServer(server.name, client, transport),
  };

  const timeout = AbortSignal.timeout(startTimeoutMs);
  const signal = params.signal === undefined ? timeout : AbortSignal.any([timeout, params.signal]);
  const requestOptions: RequestOptions = {signal, timeout: startTimeoutMs};
  try {
    started.tools = await untilAborted(
      (async () => {
        // The SDK transport types do not satisfy exactOptionalPropertyTypes.
        await client.connect(transport as unknown as Transport, requestOptions);
        return await listAllTools(client, requestOptions);
      })(),
      signal,
    );
    return started;
  } catch (error) {
    await started.stop();
    const reason = timeout.aborted
      ? `it did not answer within ${startTimeoutMs / 1000} seconds`
      : httpErrorDetail(error, params.redactions);
    throw new CustomMcpServerUnavailableError(
      server.name,
      `MCP server "${server.name}" at ${server.url} did not answer: ${reason}.`,
    );
  }
}

// The SDK sends `notifications/initialized` without a timeout, so a server that never answers it
// would hold the start past the deadline. Stopping the server then aborts that request.
function untilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, {once: true});
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

async function startStdioServer(params: {
  server: MaterializedAgentStdioMcpServerConfigDto;
  env: Readonly<Record<string, string>>;
  host: ExecutionHost;
  cwd: string;
  redactions: readonly string[];
  signal?: AbortSignal | undefined;
  startTimeoutMs?: number | undefined;
}): Promise<StartedServer> {
  const {server} = params;
  const startTimeoutMs = params.startTimeoutMs ?? CUSTOM_MCP_SERVER_START_TIMEOUT_MS;
  const redact = (text: string) => redactSecrets(text, [...params.redactions]);
  let child: HostProcess;
  try {
    child = params.host.spawn({
      argv: [server.command, ...server.args],
      cwd: params.cwd,
      env: params.env,
      stdin: 'pipe',
      // A descendant left holding the pipes would keep the exit from being seen.
      killTreeOnExit: true,
    });
  } catch (error) {
    throw unavailable(server.name, errorMessage(error), '', redact);
  }

  let stderrTail = '';
  child.stderr.setEncoding('utf8');
  // Only the tail is kept, masked as a whole in the start failure: masking chunk by chunk could
  // miss a secret split across two chunks.
  child.stderr.on('data', (chunk: string) => {
    stderrTail = `${stderrTail}${chunk}`.slice(-STDERR_TAIL_BYTES);
  });

  const client = new Client({name: 'shipfox-runner', version: '0.0.0'});
  let exit: HostProcessExit | undefined;
  let closing = false;
  const started: StartedServer = {
    name: server.name,
    client,
    tools: [],
    ended: () => (exit === undefined ? undefined : describeExit(exit)),
    failedCall: () =>
      exit === undefined ? undefined : endedServerResult(server.name, describeExit(exit)),
    stop: () => {
      closing = true;
      return stopStdioServer(server.name, client, child);
    },
  };
  let spawnError: unknown;
  child.processExited.then(
    (processExit) => {
      exit = processExit;
      if (!closing) {
        logger().warn({server: server.name, ...processExit}, 'MCP server exited during the step');
      }
    },
    (error: unknown) => {
      exit = {exitCode: null, signal: null};
      spawnError = error;
    },
  );

  const timeout = AbortSignal.timeout(startTimeoutMs);
  const signal = params.signal === undefined ? timeout : AbortSignal.any([timeout, params.signal]);
  const requestOptions: RequestOptions = {signal, timeout: startTimeoutMs};
  try {
    if (child.stdin === undefined) throw new Error('the process has no stdin pipe');
    await client.connect(new HostProcessTransport(child), requestOptions);
    started.tools = await listAllTools(client, requestOptions);
    return started;
  } catch (error) {
    await started.stop();
    let reason = errorMessage(spawnError ?? error);
    if (timeout.aborted) reason = `it did not answer within ${startTimeoutMs / 1000} seconds`;
    else if (spawnError === undefined && exit !== undefined) reason = describeExit(exit);
    throw unavailable(server.name, reason, stderrTail, redact);
  }
}

async function listAllTools(client: Client, options: RequestOptions): Promise<Tool[]> {
  const tools: Tool[] = [];
  let cursor: string | undefined;
  do {
    const page = await client.listTools(cursor === undefined ? undefined : {cursor}, options);
    tools.push(...page.tools);
    cursor = page.nextCursor;
  } while (cursor !== undefined);
  return tools;
}

function unavailable(
  server: string,
  reason: string,
  stderrTail: string,
  redact: (text: string) => string,
): CustomMcpServerUnavailableError {
  const stderr = stderrTail.trim();
  return new CustomMcpServerUnavailableError(
    server,
    redact(
      `MCP server "${server}" did not start: ${reason}.${stderr === '' ? '' : ` stderr: ${stderr}`}`,
    ),
  );
}

function describeExit(exit: HostProcessExit | undefined): string {
  if (exit?.signal) return `was stopped by ${exit.signal}`;
  if (exit?.exitCode !== null && exit?.exitCode !== undefined) {
    return `exited with code ${exit.exitCode}`;
  }
  return 'exited';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// `fetch` reports a refused connection as "fetch failed" and puts the reason in `cause`.
function errorMessageWithCause(error: unknown): string {
  const message = errorMessage(error);
  if (!(error instanceof Error) || error.cause === undefined) return message;
  return `${message} (${errorMessage(error.cause)})`;
}

async function stopServers(servers: readonly StartedServer[]): Promise<void> {
  await Promise.all(servers.map((server) => server.stop()));
}

async function closeClient(server: string, client: Client): Promise<void> {
  try {
    await client.close();
  } catch (error) {
    logger().warn({err: error, server}, 'Failed to close MCP server client');
  }
}

// Ending the session frees it on servers that keep sessions. A server that does not answer in time
// is cut off when the client closes, which aborts the request.
async function stopHttpServer(
  server: string,
  client: Client,
  transport: StreamableHTTPClientTransport,
): Promise<void> {
  await Promise.race([
    transport.terminateSession().catch((error: unknown) => {
      logger().warn({err: error, server}, 'Failed to end MCP server session');
    }),
    new Promise((resolve) => setTimeout(resolve, CLOSE_GRACE_MS).unref()),
  ]);
  await closeClient(server, client);
}

// Closing ends stdin and waits briefly for a clean exit; the tree is killed either way.
async function stopStdioServer(server: string, client: Client, child: HostProcess): Promise<void> {
  await closeClient(server, client);
  await child.killTree().catch((error: unknown) => {
    logger().warn({err: error, server}, 'Failed to stop MCP server');
  });
}

/** Newline-delimited JSON-RPC over the stdio of a process started through an execution host. */
class HostProcessTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;
  private readonly readBuffer = new ReadBuffer();
  private closed = false;

  constructor(private readonly child: HostProcess) {}

  start(): Promise<void> {
    this.child.stdout.on('data', (chunk: Buffer | string) => {
      this.readBuffer.append(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      this.processReadBuffer();
    });
    this.child.stdout.on('error', (error: Error) => this.onerror?.(error));
    this.child.stdin?.on('error', (error: Error) => this.onerror?.(error));
    // `exited` settles once stdout closed, so a response written just before the exit is read.
    this.child.exited.then(
      () => this.handleClose(),
      () => this.handleClose(),
    );
    return Promise.resolve();
  }

  send(message: JSONRPCMessage): Promise<void> {
    const stdin = this.child.stdin;
    if (this.closed || stdin === undefined || stdin.destroyed) {
      return Promise.reject(new Error('MCP server is not connected.'));
    }
    return new Promise((resolve) => {
      if (stdin.write(serializeMessage(message))) resolve();
      else stdin.once('drain', resolve);
    });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.child.stdin?.end();
    await Promise.race([
      this.child.exited.catch(() => undefined),
      new Promise((resolve) => setTimeout(resolve, CLOSE_GRACE_MS).unref()),
    ]);
    this.handleClose();
  }

  private processReadBuffer(): void {
    while (true) {
      try {
        const message = this.readBuffer.readMessage();
        if (message === null) return;
        this.onmessage?.(message);
      } catch (error) {
        this.onerror?.(error instanceof Error ? error : new Error(String(error)));
      }
    }
  }

  private handleClose(): void {
    if (this.closed) return;
    this.closed = true;
    this.readBuffer.clear();
    this.onclose?.();
  }
}
