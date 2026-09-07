import {ApiError} from '@shipfox/client-api';
import type {Query, QueryKey} from '@tanstack/react-query';
import {
  createShellQueryClient,
  isAdoptedSessionGateError,
  isAdoptedSessionPausedError,
} from './query-client.js';

const GATE_ERROR = new ApiError({
  message: 'Renewal is paused.',
  code: 'adopted-session-paused',
  status: 0,
});
const ENDED_ERROR = new ApiError({
  message: 'The adopted session ended.',
  code: 'adopted-session-ended',
  status: 0,
});
const OTHER_ERROR = new Error('ordinary failure');
type RetryPredicate = (failureCount: number, error: Error) => boolean;
type ThrowOnErrorPredicate = (error: Error, query: unknown) => boolean;
type TestQuery = Query<unknown, Error, unknown, QueryKey>;
type QueryPredicate = (query: TestQuery) => boolean;
type RefetchPredicate = (query: TestQuery) => boolean | 'always';

type TestNetworkMode = TestQuery['options']['networkMode'];

function queryWithError(error: Error, networkMode: TestNetworkMode = 'online'): TestQuery {
  return {state: {error}, options: {networkMode}} as TestQuery;
}

function queryDefaults(client: ReturnType<typeof createShellQueryClient>) {
  const queries = client.getDefaultOptions().queries;
  if (
    !queries?.retry ||
    !queries.retryOnMount ||
    !queries.refetchOnMount ||
    !queries.refetchOnWindowFocus ||
    !queries.refetchOnReconnect ||
    !queries.throwOnError
  ) {
    throw new Error('The shell query policy did not install its predicates.');
  }
  return {
    retry: queries.retry as RetryPredicate,
    retryOnMount: queries.retryOnMount as QueryPredicate,
    refetchOnMount: queries.refetchOnMount as RefetchPredicate,
    refetchOnWindowFocus: queries.refetchOnWindowFocus as RefetchPredicate,
    refetchOnReconnect: queries.refetchOnReconnect as RefetchPredicate,
    throwOnError: queries.throwOnError as ThrowOnErrorPredicate,
  };
}

describe('shell query client policy', () => {
  test('recognizes only the named adopted-session ApiError gates', () => {
    expect(isAdoptedSessionGateError(GATE_ERROR)).toBe(true);
    expect(isAdoptedSessionGateError(ENDED_ERROR)).toBe(true);
    expect(isAdoptedSessionGateError(OTHER_ERROR)).toBe(false);
    expect(isAdoptedSessionGateError({code: 'adopted-session-paused', status: 0})).toBe(false);
  });

  test('recognizes only the paused adopted-session gate as resumable', () => {
    expect(isAdoptedSessionPausedError(GATE_ERROR)).toBe(true);
    expect(isAdoptedSessionPausedError(ENDED_ERROR)).toBe(false);
    expect(isAdoptedSessionPausedError(OTHER_ERROR)).toBe(false);
  });

  test('does not retry or refetch either gate during query recovery', () => {
    const defaults = queryDefaults(createShellQueryClient());

    for (const error of [GATE_ERROR, ENDED_ERROR]) {
      const query = queryWithError(error);

      expect(defaults.retryOnMount(query)).toBe(false);
      expect(defaults.refetchOnMount(query)).toBe(false);
      expect(defaults.refetchOnWindowFocus(query)).toBe(false);
      expect(defaults.refetchOnReconnect(query)).toBe(false);
    }
  });

  test('does not retry or throw either gate while preserving intentional overrides', () => {
    const retry = vi.fn(() => true);
    const throwOnError = vi.fn(() => true);
    const client = createShellQueryClient({
      defaultOptions: {
        queries: {
          retry,
          throwOnError,
        },
      },
    });
    const defaults = queryDefaults(client);

    expect(defaults.retry(0, GATE_ERROR)).toBe(false);
    expect(defaults.retry(0, ENDED_ERROR)).toBe(false);
    expect(retry).not.toHaveBeenCalled();
    expect(defaults.throwOnError(GATE_ERROR, {} as never)).toBe(false);
    expect(defaults.throwOnError(ENDED_ERROR, {} as never)).toBe(false);
    expect(throwOnError).not.toHaveBeenCalled();

    expect(defaults.retry(0, OTHER_ERROR)).toBe(true);
    expect(defaults.throwOnError(OTHER_ERROR, {} as never)).toBe(true);
    expect(retry).toHaveBeenCalledWith(0, OTHER_ERROR);
    expect(throwOnError).toHaveBeenCalledWith(OTHER_ERROR, {});
  });

  test('keeps ordinary query behavior when a test disables retries', () => {
    const client = createShellQueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          throwOnError: true,
        },
      },
    });
    const defaults = queryDefaults(client);

    expect(defaults.retry(0, OTHER_ERROR)).toBe(false);
    expect(defaults.retry(0, GATE_ERROR)).toBe(false);
    expect(defaults.throwOnError(OTHER_ERROR, {} as never)).toBe(true);
    expect(defaults.throwOnError(GATE_ERROR, {} as never)).toBe(false);
  });
});
