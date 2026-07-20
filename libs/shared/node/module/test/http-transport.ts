import * as http from 'node:http';
import type {AddressInfo} from 'node:net';
import {
  createInterModuleClient,
  createInterModuleKnownError,
  type InterModuleClient,
  type InterModuleContract,
  type InterModuleContractDefinition,
  type InterModuleMethodContract,
  type InterModulePresentation,
} from '@shipfox/inter-module';
import {SpanKind, trace} from '@shipfox/node-opentelemetry';
import {
  drainReport,
  type HandlerSettlement,
  type InterModuleHandlerFn,
  type InterModuleReportInternalError,
  invokeHandlerWithCancellation,
  resolveInterModuleInput,
  safeParseWithDefectDetection,
} from '#inter-module/dispatch.js';
import {InterModuleOpaqueError, InterModuleValidationError} from '#inter-module/errors.js';
import {
  endInterModuleSpan,
  type InterModuleOutcome,
  startInterModuleSpan,
} from '#inter-module/tracing.js';

/**
 * A focused, test-only HTTP transport proving the local transport's semantics
 * hold across a real network boundary: wire (de)serialization, `CLIENT`/`SERVER`
 * spans, and request cancellation. Not a production transport.
 */
type ResponseEnvelope =
  | {outcome: 'success'; value: unknown}
  | {outcome: 'known-error'; code: string; details: unknown}
  | {outcome: 'validation-error'}
  | {outcome: 'opaque-error'};

export interface HttpInterModuleServerHandle {
  baseUrl: string;
  close: () => Promise<void>;
}

export function startHttpInterModuleServer(options: {
  presentations: InterModulePresentation[];
  reportInternalError?: InterModuleReportInternalError;
  tracer?: ReturnType<typeof trace.getTracer>;
}): Promise<HttpInterModuleServerHandle> {
  const tracer =
    options.tracer ?? trace.getTracer('@shipfox/node-module/inter-module/testing-http-server');
  const reportInternalError: InterModuleReportInternalError =
    options.reportInternalError ?? (() => undefined);
  const presentationsByModule = new Map(options.presentations.map((p) => [p.contract.module, p]));

  const server = http.createServer((req, res) => {
    handleRequest(req, res).catch(() => {
      // A torn-down connection (readBody's 'error' event, a reset mid-response)
      // must never surface as an unhandled rejection in the test process.
      if (!res.writableEnded && !res.destroyed) res.destroy();
    });
  });

  async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const [, moduleName, method] = url.pathname.split('/');
    const presentation = moduleName ? presentationsByModule.get(moduleName) : undefined;
    const methodContract =
      presentation && method ? presentation.contract.methods[method] : undefined;
    const handler =
      presentation && method
        ? (presentation.handlers as Record<string, InterModuleHandlerFn>)[method]
        : undefined;

    if (!presentation || !methodContract || !handler || !moduleName || !method) {
      res
        .writeHead(404, {'content-type': 'application/json'})
        .end(JSON.stringify({outcome: 'opaque-error'}));
      return;
    }

    // Input validation (resolveInterModuleInput) runs client-side, before the
    // request is sent — the server trusts its paired client, mirroring the
    // in-memory transport's single validation pass. This adapter is a focused
    // parity fixture reached only through createHttpInterModuleClient, not a
    // hardened endpoint for arbitrary callers.
    const rawBody = await readBody(req);
    let input: unknown;
    try {
      input = (JSON.parse(rawBody || 'null') as {input?: unknown}).input;
    } catch {
      res
        .writeHead(400, {'content-type': 'application/json'})
        .end(JSON.stringify({outcome: 'validation-error'}));
      return;
    }

    const endSpan = (
      span: ReturnType<typeof startInterModuleSpan>,
      outcome: InterModuleOutcome,
      knownErrorCode?: string,
    ) =>
      endInterModuleSpan(span, {
        module: moduleName,
        method,
        transport: 'http',
        outcome,
        knownErrorCode,
      });

    const controller = new AbortController();
    req.on('close', () => {
      if (!res.writableEnded && !res.destroyed)
        controller.abort(new Error('The client closed the request'));
    });

    const span = startInterModuleSpan(tracer, 'inter_module.server', SpanKind.SERVER);
    const settlement = await invokeHandlerWithCancellation({
      methodContract,
      handler,
      input,
      signal: controller.signal,
    });

    if (settlement.outcome === 'opaque') {
      drainReport(reportInternalError, settlement.reportError, {
        phase: settlement.phase,
        module: moduleName,
        method,
      });
    }

    if (settlement.outcome === 'cancelled') {
      endSpan(span, 'cancelled');
      return;
    }

    const outcome = settlement.outcome === 'opaque' ? 'opaque-error' : settlement.outcome;
    endSpan(
      span,
      outcome,
      settlement.outcome === 'known-error' ? settlement.error.code : undefined,
    );

    if (res.writableEnded || res.destroyed) return;

    const envelope = toResponseEnvelope(settlement);
    res
      .writeHead(statusForOutcome(outcome), {'content-type': 'application/json'})
      .end(JSON.stringify(envelope));
  }

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as AddressInfo;
      resolve({
        baseUrl: `http://127.0.0.1:${address.port}`,
        close: () =>
          new Promise((res, reject) => server.close((err) => (err ? reject(err) : res()))),
      });
    });
  });
}

function toResponseEnvelope(
  settlement: Exclude<HandlerSettlement, {outcome: 'cancelled'}>,
): ResponseEnvelope {
  const {outcome} = settlement;
  switch (outcome) {
    case 'success':
      return {outcome: 'success', value: settlement.value};
    case 'known-error':
      return {
        outcome: 'known-error',
        code: settlement.error.code,
        details: settlement.error.details,
      };
    case 'opaque':
      return {outcome: 'opaque-error'};
    default: {
      const exhaustive: never = outcome;
      throw new Error(`Unhandled settlement outcome: ${exhaustive as string}`);
    }
  }
}

function statusForOutcome(
  outcome: 'success' | 'known-error' | 'validation-error' | 'opaque-error',
): number {
  if (outcome === 'success') return 200;
  if (outcome === 'known-error') return 200;
  if (outcome === 'validation-error') return 400;
  return 500;
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export function createHttpInterModuleClient<Def extends InterModuleContractDefinition>(
  contract: InterModuleContract<Def>,
  options: {
    baseUrl: string;
    tracer?: ReturnType<typeof trace.getTracer>;
    reportInternalError?: InterModuleReportInternalError;
  },
): InterModuleClient<Def> {
  const tracer =
    options.tracer ?? trace.getTracer('@shipfox/node-module/inter-module/testing-http-client');
  const reportInternalError: InterModuleReportInternalError =
    options.reportInternalError ?? (() => undefined);

  return createInterModuleClient(contract, async (call) => {
    const {module, method} = call;
    const methodContract = contract.methods[method] as InterModuleMethodContract;
    const span = startInterModuleSpan(tracer, 'inter_module.client', SpanKind.CLIENT);
    const endSpan = (outcome: InterModuleOutcome, knownErrorCode?: string) =>
      endInterModuleSpan(span, {module, method, transport: 'http', outcome, knownErrorCode});

    if (call.options?.signal?.aborted) {
      endSpan('cancelled');
      throw call.options.signal.reason;
    }

    const inputResolution = resolveInterModuleInput(methodContract, call.input);
    if (inputResolution.kind !== 'valid') {
      if (inputResolution.kind === 'opaque-error') {
        drainReport(reportInternalError, inputResolution.reportError, {
          phase: inputResolution.phase,
          module,
          method,
        });
      }
      endSpan(inputResolution.kind);
      throw inputResolution.kind === 'validation-error'
        ? new InterModuleValidationError(module, method)
        : new InterModuleOpaqueError(module, method);
    }

    let response: Response;
    try {
      response = await fetch(`${options.baseUrl}/${module}/${method}`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({input: inputResolution.value}),
        signal: call.options?.signal ?? null,
      });
    } catch {
      if (call.options?.signal?.aborted) {
        endSpan('cancelled');
        throw call.options.signal.reason;
      }
      // A network-level failure (connection refused, DNS, ...), not one of the
      // closed dispatch-boundary phases — reporting it under one would
      // misattribute a transport outage as a serialization or schema defect.
      endSpan('opaque-error');
      throw new InterModuleOpaqueError(module, method);
    }

    // The response body is untrusted wire data — a malformed server, a
    // hostile actor, or a bug must never let raw JSON.parse errors, a
    // mismatched output shape, or a forged known-error code/details escape
    // this boundary as anything other than one of the transport's own error
    // types.
    let envelope: ResponseEnvelope;
    try {
      envelope = (await response.json()) as ResponseEnvelope;
    } catch {
      endSpan('opaque-error');
      throw new InterModuleOpaqueError(module, method);
    }

    if (envelope.outcome === 'success') {
      const outputParse = safeParseWithDefectDetection(methodContract.output, envelope.value);
      if (outputParse.kind !== 'valid') {
        endSpan('opaque-error');
        throw new InterModuleOpaqueError(module, method);
      }
      endSpan('success');
      return outputParse.data;
    }
    if (envelope.outcome === 'known-error') {
      try {
        const knownError = createInterModuleKnownError(
          methodContract,
          envelope.code,
          envelope.details,
        );
        endSpan('known-error', envelope.code);
        return Promise.reject(knownError);
      } catch {
        endSpan('opaque-error');
        throw new InterModuleOpaqueError(module, method);
      }
    }
    if (envelope.outcome === 'validation-error') {
      endSpan('validation-error');
      throw new InterModuleValidationError(module, method);
    }
    endSpan('opaque-error');
    throw new InterModuleOpaqueError(module, method);
  });
}
