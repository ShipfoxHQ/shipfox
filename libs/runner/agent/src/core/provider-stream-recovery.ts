import {
  type Api,
  type AssistantMessage,
  type AssistantMessageEvent,
  type AssistantMessageEventStream,
  type Context,
  createAssistantMessageEventStream,
  type Model,
  type SimpleStreamOptions,
} from '@earendil-works/pi-ai';

export const PROVIDER_STREAM_INTERRUPTED_CODE = 'provider_stream_interrupted' as const;
export const PROVIDER_STREAM_INTERRUPTED_RETRY_MESSAGE =
  'Provider returned error: provider_stream_interrupted';

const NON_RETRYABLE_STRUCTURED_CODES = new Set([
  'unauthorized',
  'invalid_api_key',
  'forbidden',
  'quota_exceeded',
  'insufficient_quota',
  'billing',
  'billing_exhausted',
  'validation_error',
  'invalid_request',
  'content_filter',
  'context_length_exceeded',
  'context_window_exceeded',
  'canceled',
  'cancelled',
  'aborted',
]);

type ProviderStreamFunction = (
  model: Model<Api>,
  context: Context,
  options?: SimpleStreamOptions,
) => AssistantMessageEventStream;

type StructuredError = {
  readonly code?: unknown;
  readonly status?: unknown;
  readonly error?: unknown;
};

export function isManagedProviderStreamInterruption(
  provider: string,
  stopReason: string,
  errorMessage: string | undefined,
): boolean {
  if (provider !== 'shipfox' || stopReason !== 'error' || errorMessage === undefined) return false;
  if (hasNonRetryableStructuredError(errorMessage)) return false;
  return errorMessage.trim() === 'Stream error occurred';
}

export function wrapManagedProviderStream(
  streamSimple: ProviderStreamFunction,
): ProviderStreamFunction {
  return (model, context, options) => {
    const wrapped = createAssistantMessageEventStream();
    void forwardManagedProviderStream(streamSimple(model, context, options), wrapped, model);
    return wrapped;
  };
}

async function forwardManagedProviderStream(
  source: AssistantMessageEventStream,
  target: AssistantMessageEventStream,
  model: Model<Api>,
): Promise<void> {
  try {
    for await (const event of source) {
      target.push(normalizeManagedProviderEvent(event, model));
    }
  } catch (error) {
    target.push({
      type: 'error',
      reason: 'error',
      error: failedAssistantMessage(model, error instanceof Error ? error.message : String(error)),
    });
  }
}

function normalizeManagedProviderEvent(
  event: AssistantMessageEvent,
  model: Model<Api>,
): AssistantMessageEvent {
  if (
    event.type !== 'error' ||
    !isManagedProviderStreamInterruption(
      model.provider,
      event.error.stopReason,
      event.error.errorMessage,
    )
  ) {
    return event;
  }

  return {
    ...event,
    error: {
      ...event.error,
      errorMessage: PROVIDER_STREAM_INTERRUPTED_RETRY_MESSAGE,
    },
  };
}

function hasNonRetryableStructuredError(errorMessage: string): boolean {
  const parsed = embeddedJsonObject(errorMessage);
  return parsed !== undefined && containsNonRetryableStructuredError(parsed);
}

function containsNonRetryableStructuredError(value: unknown): boolean {
  if (!isStructuredError(value)) return false;

  if (typeof value.status === 'number' && value.status >= 400 && value.status < 500) {
    return true;
  }
  if (
    typeof value.code === 'string' &&
    NON_RETRYABLE_STRUCTURED_CODES.has(value.code.toLowerCase())
  ) {
    return true;
  }
  return value.error !== undefined && containsNonRetryableStructuredError(value.error);
}

function isStructuredError(value: unknown): value is StructuredError {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function embeddedJsonObject(value: string): unknown {
  const start = value.indexOf('{');
  const end = value.lastIndexOf('}');
  if (start === -1 || end <= start) return undefined;
  try {
    return JSON.parse(value.slice(start, end + 1)) as unknown;
  } catch {
    return undefined;
  }
}

function failedAssistantMessage(model: Model<Api>, errorMessage: string): AssistantMessage {
  return {
    role: 'assistant',
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0},
    },
    stopReason: 'error',
    errorMessage,
    timestamp: Date.now(),
  };
}
