import * as sentry from '@sentry/node';

vi.mock('@sentry/node', () => ({
  captureException: vi.fn(),
  withScope: vi.fn(),
}));

import {isErrorReported, markErrorReported, reportError} from './report-error.js';

const scope = {
  setExtras: vi.fn(),
  setTag: vi.fn(),
  setTags: vi.fn(),
};

function resetSentry(): void {
  vi.mocked(sentry.captureException).mockReset();
  vi.mocked(sentry.withScope).mockReset();
  scope.setExtras.mockReset();
  scope.setTag.mockReset();
  scope.setTags.mockReset();
  vi.mocked(sentry.withScope).mockImplementation((callback) => callback(scope));
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

  test('uses a local scope for boundary, tags, and extras', () => {
    resetSentry();
    const error = new Error('unexpected');

    const eventId = reportError(error, {
      boundary: 'api.runtime',
      operation: 'worker.run',
      tags: {worker: 'outbox'},
      extra: {attempt: 2},
    });

    expect(eventId).toBe('event-id');
    expect(sentry.withScope).toHaveBeenCalledOnce();
    expect(scope.setTag).toHaveBeenCalledWith('boundary', 'api.runtime');
    expect(scope.setTag).toHaveBeenCalledWith('operation', 'worker.run');
    expect(scope.setTags).toHaveBeenCalledWith({worker: 'outbox'});
    expect(scope.setExtras).toHaveBeenCalledWith({attempt: 2});
    expect(isErrorReported(error)).toBe(true);
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
