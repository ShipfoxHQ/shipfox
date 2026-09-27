import {type Exception, type SpanStatus, SpanStatusCode} from '@opentelemetry/api';
import type {Span, SpanProcessor} from '@opentelemetry/sdk-trace-node';

const FASTIFY_INSTRUMENTATION_SCOPE = '@fastify/otel';

/**
 * @fastify/otel marks its spans as failed for every thrown error, including 4xx client errors.
 * HTTP semantic conventions leave those spans unset, and a failed status makes tail sampling keep
 * every rejected request. A client error is recorded as `error.type` and `error.message`
 * attributes instead, which also saves the billed exception event.
 */
export class ClientErrorStatusSpanProcessor implements SpanProcessor {
  onStart(span: Span): void {
    if (span.instrumentationScope.name !== FASTIFY_INSTRUMENTATION_SCOPE) return;

    const setStatus = span.setStatus.bind(span);
    const recordException = span.recordException.bind(span);
    const end = span.end.bind(span);
    let errorStatus: SpanStatus | undefined;
    let clientError = false;

    span.setStatus = (status) => {
      if (status.code !== SpanStatusCode.ERROR) return setStatus(status);
      errorStatus = status;
      return span;
    };
    span.recordException = (exception, time) => {
      const reason = clientErrorReason(exception);
      if (!reason) {
        recordException(exception, time);
        return;
      }
      clientError = true;
      span.setAttributes({'error.type': reason.type, 'error.message': reason.message});
    };
    span.end = (endTime) => {
      if (errorStatus && !clientError) setStatus(errorStatus);
      end(endTime);
    };
  }

  onEnd(): void {
    // Status is settled in the wrapped `end` before the span reaches this hook.
  }

  forceFlush(): Promise<void> {
    return Promise.resolve();
  }

  shutdown(): Promise<void> {
    return Promise.resolve();
  }
}

function clientErrorReason(exception: Exception): {type: string; message: string} | undefined {
  if (typeof exception !== 'object' || !('statusCode' in exception)) return undefined;
  const {statusCode, code, message} = exception as {
    statusCode: unknown;
    code?: unknown;
    message?: unknown;
  };
  if (typeof statusCode !== 'number' || statusCode < 400 || statusCode >= 500) return undefined;
  return {
    type: typeof code === 'string' ? code : String(statusCode),
    message: typeof message === 'string' ? message : '',
  };
}
