import {context} from '@opentelemetry/api';
import * as sentry from '@sentry/node';
import {
  SentryAsyncLocalStorageContextManager,
  setOpenTelemetryContextAsyncContextStrategy,
} from '@sentry/opentelemetry';

vi.mock('@sentry/node', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@sentry/node')>()),
  captureException: vi.fn(),
}));

import {isErrorReported, markErrorReported, reportError} from './report-error.js';

const contextManager = new SentryAsyncLocalStorageContextManager();

beforeAll(() => {
  context.disable();
  context.setGlobalContextManager(contextManager.enable());
  setOpenTelemetryContextAsyncContextStrategy();
});

afterAll(() => {
  context.disable();
  contextManager.disable();
});

function resetSentry(): void {
  vi.mocked(sentry.captureException).mockReset();
  vi.mocked(sentry.captureException).mockReturnValue('event-id');
}

describe('reportError', () => {
  test('normalizes a non-Error throw without serializing its value', () => {
    resetSentry();
    const eventId = reportError({secret: 'do-not-capture'}, {boundary: 'test'});

    expect(eventId).toBe('event-id');
    expect(sentry.captureException).toHaveBeenCalledWith(expect.any(Error));
    expect(vi.mocked(sentry.captureException).mock.calls[0]?.[0].message).toBe(
      'Non-Error value thrown',
    );
    expect(vi.mocked(sentry.captureException).mock.calls[0]?.[0]).not.toHaveProperty('secret');
  });

  test('uses fresh scopes for boundary, tags, extras, and fingerprint', () => {
    resetSentry();
    const error = new Error('unexpected');
    let capturedCurrentScope: ReturnType<sentry.Scope['getScopeData']> | undefined;
    let capturedIsolationScope: ReturnType<sentry.Scope['getScopeData']> | undefined;
    vi.mocked(sentry.captureException).mockImplementation(() => {
      capturedCurrentScope = sentry.getCurrentScope().getScopeData();
      capturedIsolationScope = sentry.getIsolationScope().getScopeData();
      return 'event-id';
    });
    const ambientIsolationScope = new sentry.Scope();
    ambientIsolationScope.setTag('operation', 'dropPartition');
    ambientIsolationScope.setExtra('partition', 'retention-2026-09');
    const ambientCurrentScope = new sentry.Scope();
    ambientCurrentScope.setTag('unrelated', 'retention');

    const eventId = sentry.withIsolationScope(ambientIsolationScope, () =>
      sentry.withScope(ambientCurrentScope, () =>
        reportError(error, {
          boundary: 'api.runtime',
          tags: {worker: 'outbox'},
          extra: {attempt: 2},
          fingerprint: ['api.runtime', 'outbox'],
        }),
      ),
    );

    expect(eventId).toBe('event-id');
    expect(ambientIsolationScope.getScopeData().tags).toEqual({operation: 'dropPartition'});
    expect(capturedCurrentScope?.tags).toEqual({boundary: 'api.runtime', worker: 'outbox'});
    expect(capturedCurrentScope?.extra).toEqual({attempt: 2});
    expect(capturedCurrentScope?.fingerprint).toEqual(['api.runtime', 'outbox']);
    expect(capturedIsolationScope?.tags).toEqual({});
    expect(capturedIsolationScope?.extra).toEqual({});
    expect(isErrorReported(error)).toBe(true);
  });

  test('keeps concurrent reports isolated from each other and their ambient scopes', async () => {
    resetSentry();
    const captures: Array<{
      message: string;
      current: ReturnType<sentry.Scope['getScopeData']>;
      isolation: ReturnType<sentry.Scope['getScopeData']>;
    }> = [];
    vi.mocked(sentry.captureException).mockImplementation((error) => {
      captures.push({
        message: error instanceof Error ? error.message : 'unknown',
        current: sentry.getCurrentScope().getScopeData(),
        isolation: sentry.getIsolationScope().getScopeData(),
      });
      return 'event-id';
    });
    let startFirst: (() => void) | undefined;
    const firstGate = new Promise<void>((resolve) => {
      startFirst = resolve;
    });
    const retentionScope = new sentry.Scope();
    retentionScope.setTag('operation', 'dropPartition');
    retentionScope.setExtra('partition', 'retention-2026-09');
    const deliveryScope = new sentry.Scope();
    deliveryScope.setTag('operation', 'deliverWebhook');
    deliveryScope.setExtra('webhookId', 'webhook-1');

    const firstReport = sentry.withIsolationScope(retentionScope, async () => {
      await firstGate;
      return reportError(new Error('first'), {
        boundary: 'integration.agent-tool',
        tags: {request: 'first'},
      });
    });
    const secondReport = sentry.withIsolationScope(deliveryScope, async () => {
      startFirst?.();
      await Promise.resolve();
      return reportError(new Error('second'), {
        boundary: 'integration.agent-tool',
        tags: {request: 'second'},
      });
    });

    await Promise.all([firstReport, secondReport]);

    expect(captures).toHaveLength(2);
    expect(captures.find(({message}) => message === 'first')?.current.tags).toEqual({
      boundary: 'integration.agent-tool',
      request: 'first',
    });
    expect(captures.find(({message}) => message === 'second')?.current.tags).toEqual({
      boundary: 'integration.agent-tool',
      request: 'second',
    });
    expect(captures.every(({isolation}) => Object.keys(isolation.tags).length === 0)).toBe(true);
    expect(captures.every(({isolation}) => Object.keys(isolation.extra).length === 0)).toBe(true);
  });

  test('suppresses an error reported by an earlier boundary', () => {
    resetSentry();
    const error = new Error('unexpected');
    markErrorReported(error);

    const eventId = reportError(error, {boundary: 'http.unhandled'});

    expect(eventId).toBeUndefined();
    expect(sentry.captureException).not.toHaveBeenCalled();
  });

  test('deduplicates a frozen error without throwing', () => {
    resetSentry();
    const error = Object.freeze(new Error('unexpected'));

    const firstEventId = reportError(error, {boundary: 'test'});
    const secondEventId = reportError(error, {boundary: 'http.unhandled'});

    expect(firstEventId).toBe('event-id');
    expect(secondEventId).toBeUndefined();
    expect(sentry.captureException).toHaveBeenCalledTimes(1);
  });

  test('deduplicates a non-Error object throw', () => {
    resetSentry();
    const thrown = {reason: 'unexpected'};

    reportError(thrown, {boundary: 'test'});
    const eventId = reportError(thrown, {boundary: 'http.unhandled'});

    expect(eventId).toBeUndefined();
    expect(sentry.captureException).toHaveBeenCalledTimes(1);
  });

  test('only marks errors after Sentry accepts the capture', () => {
    resetSentry();
    const error = new Error('unexpected');
    vi.mocked(sentry.captureException).mockReturnValue(undefined);

    const eventId = reportError(error, {boundary: 'test'});

    expect(eventId).toBeUndefined();
    expect(isErrorReported(error)).toBe(false);
  });

  test('does not throw when Sentry capture fails', () => {
    resetSentry();
    const error = new Error('unexpected');
    vi.mocked(sentry.captureException).mockImplementation(() => {
      throw new Error('Sentry unavailable');
    });

    const eventId = reportError(error, {boundary: 'test'});

    expect(eventId).toBeUndefined();
    expect(isErrorReported(error)).toBe(false);
  });
});
