import {trace} from '@opentelemetry/api';
import {createLogger} from '@shipfox/node-log';
import {processState} from '@shipfox/node-process-state';
import {getContextMetadata} from './context.js';

type Logger = ReturnType<typeof createLogger>;
type LoggerOptions = Parameters<typeof createLogger>[0];

const state = processState<{baseLogger?: Logger | undefined}>(
  '@shipfox/node-opentelemetry/logger/v1',
  () => ({}),
  import.meta.url,
);

function getBaseLogger(): Logger {
  state.baseLogger ??= createLogger({});
  return state.baseLogger;
}

export function logger(options?: LoggerOptions): Logger {
  const base = options ? createLogger(options) : getBaseLogger();
  const span = trace.getActiveSpan();
  const metadata = getContextMetadata();
  const hasMetadata = Object.keys(metadata).length > 0;

  if (!span && !hasMetadata) {
    return base;
  }

  const bindings: Record<string, string> = {...metadata};

  if (span) {
    const spanContext = span.spanContext();
    bindings.traceId = spanContext.traceId;
    bindings.spanId = spanContext.spanId;
  }

  return base.child(bindings);
}
