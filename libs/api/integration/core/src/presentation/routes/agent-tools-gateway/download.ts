import {Readable, Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import type {ReadableStream as NodeReadableStream} from 'node:stream/web';
import {requireLeasedJobContext} from '@shipfox/api-auth-context';
import {MAX_AGENT_TOOL_FILE_BYTES} from '@shipfox/api-integration-spi';
import {reportError} from '@shipfox/node-error-monitoring';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {logger} from '@shipfox/node-opentelemetry';
import {z} from 'zod';
import type {WorkspaceBuiltinConnection} from '#core/agent-tool-selection.js';
import type {IntegrationProviderRegistry} from '#core/providers/registry.js';
import type {RepositoryAuthorizer} from '#core/repository-authorizer.js';
import {
  createIntegrationToolCallRecorder,
  INVALID_METHOD_LABEL,
  type IntegrationToolCallAuditRecord,
  type IntegrationToolCallRecorder,
  integrationToolCallAuthorizationAuditFields,
  NO_METHOD_LABEL,
} from '#core/tool-call-audit.js';
import {
  fileTooLargeError,
  type IntegrationToolCallError,
  type IntegrationToolDownloadInput,
  integrationToolDownloadError,
  openIntegrationToolDownload,
} from '#core/tool-call-service.js';
import type {GetIntegrationConnectionByIdFn} from '#db/connections.js';
import {CALL_ID_HEADER, leasedToolCaller} from './caller.js';
import {type IntegrationToolProtocolErrorReason, validateMethod} from './mcp-server.js';
import {
  type AuthorizedIntegrationTool,
  authorizedToolResultKind,
  type LeasedAgentStepLoader,
  resolveAuthorizedIntegrationTools,
} from './resolve-authorized-tools.js';

/** Remaining milliseconds of the runner's own deadline, so both ends share one number. */
const DEADLINE_HEADER = 'x-shipfox-deadline';
const MAX_DOWNLOAD_DURATION_MS = 5 * 60 * 1000;
const DEADLINE_PATTERN = /^\d{1,10}$/;
const MEDIA_TYPE_PATTERN = /^[\w.+-]+\/[\w.+-]+(?: *;[\x20-\x7e]*)?$/;
const RFC5987_RESERVED_PATTERN = /['()*]/g;

const toolDownloadBodySchema = z.object({
  connection_slug: z.string().min(1),
  tool: z.string().min(1),
  arguments: z.record(z.string(), z.unknown()).default({}),
});

export interface ToolDownloadRouteParams {
  loadLeasedAgentStep: LeasedAgentStepLoader;
  registry: IntegrationProviderRegistry;
  getIntegrationConnectionById: GetIntegrationConnectionByIdFn;
  builtinConnections?: readonly WorkspaceBuiltinConnection[] | undefined;
  repositoryAuthorizer?: RepositoryAuthorizer | undefined;
}

/**
 * Streams a file tool's result to the leased action step. It authorizes like the MCP
 * route; the bytes pass through without buffering and stop at the per-file limit.
 */
export function createToolDownloadRoute(params: ToolDownloadRouteParams) {
  return defineRoute({
    method: 'POST',
    path: '/download',
    description: 'Streams the file a granted file tool returns to a leased action step',
    schema: {body: toolDownloadBodySchema},
    handler: async (request, reply) => {
      const startedAt = Date.now();
      const lease = requireLeasedJobContext(request);
      const {stepType, tools} = await resolveAuthorizedIntegrationTools({
        request,
        loadLeasedAgentStep: params.loadLeasedAgentStep,
        registry: params.registry,
        getIntegrationConnectionById: params.getIntegrationConnectionById,
        builtinConnections: params.builtinConnections,
      });
      if (stepType !== 'action') {
        throw new ClientError('Only action steps can download files', 'leased-step-not-action', {
          status: 409,
        });
      }
      const caller = leasedToolCaller({stepType, callId: request.headers[CALL_ID_HEADER]});
      const recordCall = createIntegrationToolCallRecorder({...caller, lease});
      const args = request.body.arguments;
      const {authorizedTool, method} = grantedFileTool({
        tools: tools.values(),
        connectionSlug: request.body.connection_slug,
        toolId: request.body.tool,
        arguments: args,
        recordCall,
      });
      const audit = (fields: Omit<IntegrationToolCallAuditRecord, 'arguments' | 'method'>) =>
        record(recordCall, {
          authorizedTool,
          arguments: args,
          method: method ?? NO_METHOD_LABEL,
          resultKind: 'file',
          ...fields,
        });

      const controller = new AbortController();
      const deadline = setTimeout(
        () => controller.abort(namedError('TimeoutError', 'The download deadline passed')),
        downloadDeadlineMs(request.headers[DEADLINE_HEADER]) - (Date.now() - startedAt),
      );
      const onClose = () => {
        if (!reply.raw.writableFinished) {
          controller.abort(namedError('AbortError', 'The runner disconnected'));
        }
      };
      reply.raw.on('close', onClose);
      // The runner can leave while the grants load; its close event has then already fired.
      if (reply.raw.destroyed) onClose();
      const input: IntegrationToolDownloadInput = {
        registry: params.registry,
        connection: authorizedTool.connection,
        integration: authorizedTool.integration,
        tool: authorizedTool.tool,
        arguments: args,
        method,
        caller: {...caller, lease},
        catalogEntry: authorizedTool.catalogEntry,
        repositoryAuthorizer: params.repositoryAuthorizer,
        signal: controller.signal,
      };

      try {
        const opened = await openIntegrationToolDownload(input);
        const authorizationFields = integrationToolCallAuthorizationAuditFields(
          opened.authorization,
        );
        if (opened.outcome === 'error') {
          audit({...toolErrorAudit(opened.error), ...authorizationFields, bytes: 0});
          throw toolClientError(opened.error);
        }

        reply.hijack();
        reply.raw.writeHead(200, fileHeaders(opened.file));
        const streamed = await streamFileBody({
          body: opened.file.body,
          destination: reply.raw,
          signal: controller.signal,
        });
        if (streamed.outcome === 'success') {
          audit({
            outcome: 'success',
            errorCode: 'none',
            ...authorizationFields,
            bytes: streamed.bytes,
          });
          return;
        }
        // Headers are sent, so the runner learns of the failure from the cut stream.
        const failure =
          streamed.outcome === 'too-large'
            ? fileTooLargeError(MAX_AGENT_TOOL_FILE_BYTES)
            : integrationToolDownloadError(input, streamed.error);
        controller.abort(streamed.error);
        reply.raw.destroy();
        audit({...toolErrorAudit(failure), ...authorizationFields, bytes: streamed.bytes});
      } finally {
        clearTimeout(deadline);
        reply.raw.off('close', onClose);
      }
    },
  });
}

/** Finds the frozen grant and checks it is a file tool, auditing and throwing on refusal. */
function grantedFileTool(params: {
  tools: Iterable<AuthorizedIntegrationTool>;
  connectionSlug: string;
  toolId: string;
  arguments: Record<string, unknown>;
  recordCall: IntegrationToolCallRecorder;
}): {authorizedTool: AuthorizedIntegrationTool; method?: string | undefined} {
  const {connectionSlug, toolId, recordCall} = params;
  const args = params.arguments;
  const authorizedTool = findGrantedTool(params.tools, connectionSlug, toolId);
  if (authorizedTool === undefined) {
    record(recordCall, {arguments: args, method: NO_METHOD_LABEL, ...invalidRequest()});
    throw protocolError(`Unknown integration tool: ${connectionSlug}.${toolId}`, {
      reason: 'tool_not_found',
      tool: toolId,
    });
  }
  if (authorizedToolResultKind(authorizedTool) !== 'file') {
    record(recordCall, {
      authorizedTool,
      arguments: args,
      method: NO_METHOD_LABEL,
      ...invalidRequest(),
    });
    throw protocolError(`${toolId} does not return a file`, {
      reason: 'result_kind_mismatch',
      tool: toolId,
    });
  }
  const methodValidation = validateMethod(authorizedTool, args);
  if (methodValidation.kind === 'error') {
    record(recordCall, {
      authorizedTool,
      arguments: args,
      method: INVALID_METHOD_LABEL,
      ...invalidRequest(),
    });
    throw protocolError(methodValidation.message, methodValidation.details);
  }
  return {authorizedTool, method: methodValidation.method};
}

async function streamFileBody(params: {
  body: ReadableStream<Uint8Array>;
  destination: NodeJS.WritableStream;
  signal: AbortSignal;
}): Promise<
  | {outcome: 'success'; bytes: number}
  | {outcome: 'too-large' | 'failed'; bytes: number; error: unknown}
> {
  let bytes = 0;
  let tooLarge = false;
  try {
    await pipeline(
      Readable.fromWeb(params.body as NodeReadableStream<Uint8Array>),
      new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          if (bytes + chunk.length > MAX_AGENT_TOOL_FILE_BYTES) {
            tooLarge = true;
            return callback(new Error('The file exceeded the download limit'));
          }
          bytes += chunk.length;
          callback(null, chunk);
        },
      }),
      params.destination,
      {signal: params.signal},
    );
    return {outcome: 'success', bytes};
  } catch (error) {
    return {outcome: tooLarge ? 'too-large' : 'failed', bytes, error};
  }
}

function findGrantedTool(
  tools: Iterable<AuthorizedIntegrationTool>,
  connectionSlug: string,
  toolId: string,
): AuthorizedIntegrationTool | undefined {
  for (const tool of tools) {
    if (tool.integration.connectionSlug === connectionSlug && tool.tool.id === toolId) return tool;
  }
  return undefined;
}

function downloadDeadlineMs(header: string | string[] | undefined): number {
  const requested =
    typeof header === 'string' && DEADLINE_PATTERN.test(header) ? Number(header) : Number.NaN;
  return Number.isNaN(requested)
    ? MAX_DOWNLOAD_DURATION_MS
    : Math.min(requested, MAX_DOWNLOAD_DURATION_MS);
}

function fileHeaders(file: {
  mediaType: string;
  filename?: string | undefined;
  size?: number | undefined;
}): Record<string, string> {
  const filename = file.filename === undefined ? undefined : rfc5987Value(file.filename);
  return {
    'content-type': isHeaderSafe(file.mediaType) ? file.mediaType : 'application/octet-stream',
    'cache-control': 'no-store',
    ...(filename === undefined ? {} : {'x-shipfox-filename': filename}),
    ...(file.size !== undefined && Number.isSafeInteger(file.size) && file.size >= 0
      ? {'x-shipfox-size': String(file.size)}
      : {}),
  };
}

function isHeaderSafe(mediaType: string): boolean {
  return MEDIA_TYPE_PATTERN.test(mediaType);
}

function rfc5987Value(filename: string): string | undefined {
  try {
    const encoded = encodeURIComponent(filename).replace(
      RFC5987_RESERVED_PATTERN,
      (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
    );
    return `UTF-8''${encoded}`;
  } catch {
    // A lone surrogate cannot be encoded; the runner falls back to a generated name.
    return undefined;
  }
}

function namedError(name: string, message: string): Error {
  const error = new Error(message);
  error.name = name;
  return error;
}

function invalidRequest(): Pick<IntegrationToolCallAuditRecord, 'outcome' | 'errorCode'> {
  return {outcome: 'invalid-request', errorCode: 'invalid-request'};
}

function toolErrorAudit(
  error: IntegrationToolCallError,
): Pick<IntegrationToolCallAuditRecord, 'outcome' | 'errorCode' | 'providerStatus'> {
  return {
    outcome: 'tool-error',
    errorCode: error.code,
    ...(error.status === undefined ? {} : {providerStatus: error.status}),
  };
}

function protocolError(
  message: string,
  details: {
    reason: IntegrationToolProtocolErrorReason;
    tool?: string | undefined;
    parameter?: string | undefined;
  },
): ClientError {
  return new ClientError(message, 'invalid-request', {
    status: 400,
    details: {
      message,
      reason: details.reason,
      ...(details.tool === undefined ? {} : {tool: details.tool}),
      ...(details.parameter === undefined ? {} : {parameter: details.parameter}),
    },
  });
}

const HTTP_STATUS_BY_CODE: Partial<Record<IntegrationToolCallError['code'], number>> = {
  'invalid-request': 400,
  'file-location-not-allowed': 400,
  'access-denied': 403,
  'repository-required': 403,
  'repository-not-granted': 403,
  'repository-ambiguous': 403,
  'not-found': 404,
  'file-not-found': 404,
  'file-too-large': 413,
  'rate-limited': 429,
  'repository-authorization-unavailable': 503,
  'provider-timeout': 504,
};

function toolClientError(error: IntegrationToolCallError): ClientError {
  return new ClientError(error.message, error.code, {
    status: HTTP_STATUS_BY_CODE[error.code] ?? 502,
    details: {
      message: error.message,
      ...(error.retryAfterSeconds === undefined
        ? {}
        : {retryAfterSeconds: error.retryAfterSeconds}),
      ...(error.status === undefined ? {} : {status: error.status}),
    },
  });
}

function record(recordCall: IntegrationToolCallRecorder, entry: IntegrationToolCallAuditRecord) {
  try {
    recordCall(entry);
  } catch (error) {
    // Audit and metrics must not affect the download.
    logger().error({err: error}, 'Failed to record integration tool download audit event');
    reportError(error, {boundary: 'integration.agent-tool', operation: 'audit'});
  }
}
