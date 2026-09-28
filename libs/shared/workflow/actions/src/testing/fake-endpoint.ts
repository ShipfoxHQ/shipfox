import {randomBytes, randomUUID} from 'node:crypto';
import {createServer, type IncomingMessage, type ServerResponse} from 'node:http';
import type {AddressInfo} from 'node:net';
import {Readable} from 'node:stream';
import {
  MAX_DOWNLOAD_FILE_BYTES,
  MAX_STEP_DOWNLOAD_BYTES,
  TOOLS_CALL_PATH,
  TOOLS_DOWNLOAD_PATH,
  type ToolCallResponseV1,
  type ToolDownloadResponseV1,
  type ToolErrorV1,
  type ToolFailureResponseV1,
} from '#contract.js';
import {
  createDownloadBudget,
  DownloadWriteError,
  resolveDownloadTarget,
  writeDownloadedFile,
} from '#download-writer.js';
import {
  FakeToolError,
  type FakeToolFile,
  FakeToolResult,
  type ToolFakes,
  toolResult,
} from '#testing/fakes.js';
import {findGrant, type GrantedIntegration} from '#testing/manifest.js';

const DEFAULT_MEDIA_TYPE = 'application/octet-stream';
const ROUTE_KINDS: Readonly<Record<string, 'json' | 'file'>> = {
  [TOOLS_CALL_PATH]: 'json',
  [TOOLS_DOWNLOAD_PATH]: 'file',
};

/** One tool call or download the action made, refused ones included. */
export interface RecordedToolCall {
  readonly alias: string;
  /** The tool name as the action called it: a tool id or `family.method`. */
  readonly tool: string;
  readonly args: Readonly<Record<string, unknown>>;
  /** Set for downloads. */
  readonly destination?: string;
  readonly error?: RecordedToolError;
}

export interface RecordedToolError {
  readonly code: string;
  readonly message: string;
  readonly outcomeUnknown: boolean;
}

export interface FakeEndpoint {
  readonly url: string;
  readonly token: string;
  readonly calls: readonly RecordedToolCall[];
  /** Errors fakes threw other than `toolError(...)`, such as a failed assertion. */
  readonly fakeErrors: readonly unknown[];
  close(): Promise<void>;
}

interface ToolRequest {
  alias: string;
  tool: string;
  arguments: Record<string, unknown>;
  destination?: string;
}

/**
 * Serves the `v1` tool routes the way the runner does, but answers from the test's fakes. The
 * grant rules match the runner and gateway: the alias must be declared, the tool granted, and a
 * write tool needs `allow_write`.
 */
export async function startFakeEndpoint(params: {
  grants: ReadonlyMap<string, GrantedIntegration>;
  fakes: ToolFakes;
  cwd: string;
  workspace: string;
}): Promise<FakeEndpoint> {
  const token = randomBytes(32).toString('base64url');
  const calls: RecordedToolCall[] = [];
  const fakeErrors: unknown[] = [];
  const budget = createDownloadBudget(MAX_STEP_DOWNLOAD_BYTES);

  const answer = async (
    request: ToolRequest,
    kind: 'json' | 'file',
  ): Promise<ToolCallResponseV1 | ToolDownloadResponseV1> => {
    const refusal = refuse(params, request, kind);
    if (refusal !== undefined) return {ok: false, call_id: null, error: refusal};
    const callId = randomUUID();
    const outcome = await invokeFake(params.fakes, request);
    if ('error' in outcome) {
      if ('thrown' in outcome) fakeErrors.push(outcome.thrown);
      return failure(callId, outcome.error);
    }
    const {value} = outcome;
    if (kind === 'json') {
      const result = value instanceof FakeToolResult ? value : toolResult(value);
      return {
        ok: true,
        call_id: callId,
        result: {structured: result.structured, content: result.content},
      };
    }
    const file = toFakeFile(value);
    if (file === undefined) {
      const error = new Error(
        `The fake for ${request.alias}.${request.tool} must return file bytes or {bytes, filename, mediaType}, because the tool returns a file.`,
      );
      fakeErrors.push(error);
      return failure(callId, {code: 'fake-failed', message: error.message, outcome_unknown: false});
    }
    return await writeFile(callId, request.destination ?? '', file);
  };

  const writeFile = async (
    callId: string,
    destination: string,
    file: FakeFile,
  ): Promise<ToolDownloadResponseV1> => {
    const bytes = typeof file.bytes === 'string' ? Buffer.from(file.bytes) : file.bytes;
    try {
      const target = await resolveDownloadTarget({
        workspace: params.workspace,
        cwd: params.cwd,
        destination,
      });
      const written = await writeDownloadedFile({
        target,
        cwd: params.cwd,
        filename: file.filename,
        fallbackName: `download-${callId}`,
        body: Readable.from([bytes]),
        maxBytes: MAX_DOWNLOAD_FILE_BYTES,
        budget,
      });
      return {
        ok: true,
        call_id: callId,
        file: {...written, media_type: file.mediaType ?? DEFAULT_MEDIA_TYPE},
      };
    } catch (error) {
      if (!(error instanceof DownloadWriteError)) throw error;
      return failure(callId, {code: error.code, message: error.message, outcome_unknown: false});
    }
  };

  const handle = async (request: IncomingMessage, response: ServerResponse) => {
    if (request.headers.authorization !== `Bearer ${token}`) {
      request.resume();
      response.writeHead(401).end();
      return;
    }
    const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
    const kind = own(ROUTE_KINDS, path);
    if (kind === undefined || request.method !== 'POST') {
      request.resume();
      send(response, 404, {
        ok: false,
        call_id: null,
        error: {
          code: 'not-found',
          message: `The fake endpoint does not serve ${request.method} ${path}.`,
          outcome_unknown: false,
        },
      });
      return;
    }
    const toolRequest = parseRequest(await readBody(request));
    if (toolRequest === undefined) {
      send(response, 400, {
        ok: false,
        call_id: null,
        error: {code: 'invalid-request', message: 'Invalid tool request.', outcome_unknown: false},
      });
      return;
    }
    const body = await answer(toolRequest, kind);
    calls.push(record(toolRequest, kind, body));
    send(response, 200, body);
  };

  const server = createServer((request, response) => {
    handle(request, response).catch((error: unknown) => {
      fakeErrors.push(error);
      if (!response.headersSent) response.writeHead(500).end();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });

  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    token,
    calls,
    fakeErrors,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

type FakeFile = Exclude<FakeToolFile, Uint8Array | string>;

function toFakeFile(value: unknown): FakeFile | undefined {
  if (typeof value === 'string' || value instanceof Uint8Array) return {bytes: value};
  if (!isRecord(value)) return undefined;
  const {bytes, filename, mediaType} = value;
  if (typeof bytes !== 'string' && !(bytes instanceof Uint8Array)) return undefined;
  return {
    bytes,
    ...(typeof filename === 'string' ? {filename} : {}),
    ...(typeof mediaType === 'string' ? {mediaType} : {}),
  };
}

type FakeOutcome = {value: unknown} | {error: ToolErrorV1; thrown?: unknown};

async function invokeFake(fakes: ToolFakes, request: ToolRequest): Promise<FakeOutcome> {
  const aliasFakes = own(fakes, request.alias);
  const fake = aliasFakes && own(aliasFakes, request.tool);
  if (fake === undefined) {
    return {
      error: {
        code: 'no-fake-for-tool',
        message: `No fake for ${request.alias}.${request.tool}. Add one under tools.${request.alias} in runAction.`,
        outcome_unknown: false,
      },
    };
  }
  try {
    return {value: await fake(request.arguments)};
  } catch (error) {
    if (error instanceof FakeToolError) return {error: error.error};
    return {
      thrown: error,
      error: {
        code: 'fake-failed',
        message: `The fake for ${request.alias}.${request.tool} threw: ${errorMessage(error)}`,
        outcome_unknown: false,
      },
    };
  }
}

function refuse(
  params: {grants: ReadonlyMap<string, GrantedIntegration>},
  request: ToolRequest,
  kind: 'json' | 'file',
): ToolErrorV1 | undefined {
  const integration = params.grants.get(request.alias);
  if (integration === undefined) {
    return notGranted(`action.yml declares no integration named "${request.alias}".`);
  }
  const grant = findGrant(integration, request.tool);
  if (grant === undefined) {
    return notGranted(`The action is not granted ${request.alias}.${request.tool}.`);
  }
  if (grant.sensitivity === 'write' && !integration.allowWrite) {
    return notGranted(
      `${request.alias}.${request.tool} changes external data. Set allow_write: true on integration "${request.alias}" in action.yml.`,
    );
  }
  if (grant.result !== kind) {
    return {
      code: 'tool-result-kind-mismatch',
      message:
        grant.result === 'file'
          ? `${request.tool} returns a file. Use download() instead of call().`
          : `${request.tool} does not return a file. Use call() instead of download().`,
      outcome_unknown: false,
    };
  }
  return undefined;
}

function notGranted(message: string): ToolErrorV1 {
  return {code: 'tool-not-granted', message, outcome_unknown: false};
}

function failure(callId: string, error: ToolErrorV1): ToolFailureResponseV1 {
  return {ok: false, call_id: callId, error};
}

function record(
  request: ToolRequest,
  kind: 'json' | 'file',
  response: ToolCallResponseV1 | ToolDownloadResponseV1,
): RecordedToolCall {
  return {
    alias: request.alias,
    tool: request.tool,
    args: request.arguments,
    ...(kind === 'file' && request.destination !== undefined
      ? {destination: request.destination}
      : {}),
    ...(response.ok
      ? {}
      : {
          error: {
            code: response.error.code,
            message: response.error.message,
            outcomeUnknown: response.error.outcome_unknown,
          },
        }),
  };
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

function parseRequest(body: string): ToolRequest | undefined {
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    return undefined;
  }
  if (!isRecord(value)) return undefined;
  const {alias, tool, destination} = value;
  const args = value.arguments ?? {};
  if (typeof alias !== 'string' || typeof tool !== 'string' || !isRecord(args)) return undefined;
  return {
    alias,
    tool,
    arguments: args,
    ...(typeof destination === 'string' ? {destination} : {}),
  };
}

function send(response: ServerResponse, status: number, body: unknown): void {
  if (response.destroyed || response.headersSent) return;
  response.writeHead(status, {'content-type': 'application/json'}).end(JSON.stringify(body));
}

function own<T>(record: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
