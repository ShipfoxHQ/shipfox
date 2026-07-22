import * as Sentry from '@sentry/node';

const errorReportedMarker = Symbol.for('@shipfox/error-reported');
const reportedErrors = new WeakSet<object>();

export interface ErrorReportContext {
  boundary: string;
  operation?: string;
  tags?: Record<string, string | number | boolean>;
  extra?: Record<string, string | number | boolean | null | undefined>;
}

type MarkableError = Error & {[errorReportedMarker]?: true};

function toReportableError(error: unknown): Error {
  if (error instanceof Error) return error;
  return new Error('Non-Error value thrown');
}

function isObject(value: unknown): value is object {
  return typeof value === 'object' && value !== null;
}

export function markErrorReported(error: unknown): void {
  if (!isObject(error)) return;
  reportedErrors.add(error);
  try {
    Object.defineProperty(error, errorReportedMarker, {
      configurable: false,
      enumerable: false,
      value: true,
      writable: false,
    });
  } catch {
    // The WeakSet is the local source of truth when a frozen error rejects a marker.
  }
}

export function isErrorReported(error: unknown): boolean {
  return (
    isObject(error) &&
    (reportedErrors.has(error) || (error as MarkableError)[errorReportedMarker] === true)
  );
}

export function reportError(error: unknown, context: ErrorReportContext): string | undefined {
  if (isErrorReported(error)) return undefined;

  const reportableError = toReportableError(error);
  try {
    const eventId = Sentry.withScope((scope) => {
      scope.setTag('boundary', context.boundary);
      if (context.operation) scope.setTag('operation', context.operation);
      if (context.tags) scope.setTags(context.tags);
      if (context.extra) scope.setExtras(context.extra);
      return Sentry.captureException(reportableError);
    });
    if (eventId) {
      markErrorReported(error);
      markErrorReported(reportableError);
    }
    return eventId;
  } catch {
    return undefined;
  }
}
