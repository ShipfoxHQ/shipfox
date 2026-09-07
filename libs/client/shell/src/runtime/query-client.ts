import {ApiError} from '@shipfox/client-api';
import {
  isServer,
  type Query,
  QueryClient,
  type QueryClientConfig,
  type QueryKey,
} from '@tanstack/react-query';

export const ADOPTED_SESSION_GATE_CODES = [
  'adopted-session-paused',
  'adopted-session-ended',
] as const;

export type AdoptedSessionGateCode = (typeof ADOPTED_SESSION_GATE_CODES)[number];

type ShellQuery = Query<unknown, Error, unknown, QueryKey>;
type ShellDefaultOptions = NonNullable<QueryClientConfig['defaultOptions']>;
type ShellQueryOptions = NonNullable<ShellDefaultOptions['queries']>;
type ShellRetry = ShellQueryOptions['retry'];
type ShellThrowOnError = ShellQueryOptions['throwOnError'];
type ShellRetryOnMount = ShellQueryOptions['retryOnMount'];
type ShellRefetchOption = ShellQueryOptions['refetchOnMount'];

/** Returns true only for the safe, client-synthesized adopted-session gate errors. */
export function isAdoptedSessionGateError(error: unknown): error is ApiError {
  return (
    error instanceof ApiError &&
    (error.code === 'adopted-session-paused' || error.code === 'adopted-session-ended')
  );
}

/** Returns true for the non-terminal gate that focus recovery can clear. */
export function isAdoptedSessionPausedError(error: unknown): error is ApiError {
  return isAdoptedSessionGateError(error) && error.code === 'adopted-session-paused';
}

function createRetryPredicate(configuredRetry: ShellRetry): NonNullable<ShellRetry> {
  return (failureCount, error) => {
    if (isAdoptedSessionGateError(error)) return false;
    if (typeof configuredRetry === 'function') return configuredRetry(failureCount, error);
    if (typeof configuredRetry === 'number') return failureCount < configuredRetry;
    if (configuredRetry !== undefined) return configuredRetry;

    return !isServer && failureCount < 3;
  };
}

function createThrowOnErrorPredicate(
  configuredThrowOnError: ShellThrowOnError,
): NonNullable<ShellThrowOnError> {
  return (error, query) => {
    if (isAdoptedSessionGateError(error)) return false;
    if (typeof configuredThrowOnError === 'function') {
      return configuredThrowOnError(error, query);
    }
    return configuredThrowOnError ?? false;
  };
}

function createRetryOnMountPredicate(
  configuredRetryOnMount: ShellRetryOnMount,
): NonNullable<ShellRetryOnMount> {
  return (query) => {
    if (isAdoptedSessionGateError(query.state.error)) return false;
    if (typeof configuredRetryOnMount === 'function') return configuredRetryOnMount(query);
    return configuredRetryOnMount ?? true;
  };
}

function createRefetchPredicate(
  configuredRefetch: ShellRefetchOption,
  fallback: (query: ShellQuery) => boolean | 'always',
): NonNullable<ShellRefetchOption> {
  return (query) => {
    if (isAdoptedSessionGateError(query.state.error)) return false;
    if (typeof configuredRefetch === 'function') return configuredRefetch(query);
    return configuredRefetch ?? fallback(query);
  };
}

/**
 * Creates the query client used by shell-owned composition paths.
 *
 * Gate errors stay in query state until the adopted session can continue. Any
 * caller-supplied query defaults still apply to other errors, which lets test
 * harnesses disable ordinary retries without weakening the gate policy.
 */
export function createShellQueryClient(config: QueryClientConfig = {}): QueryClient {
  const configuredQueries = config.defaultOptions?.queries;

  return new QueryClient({
    ...config,
    defaultOptions: {
      ...config.defaultOptions,
      queries: {
        ...configuredQueries,
        retry: createRetryPredicate(configuredQueries?.retry),
        retryOnMount: createRetryOnMountPredicate(configuredQueries?.retryOnMount),
        refetchOnMount: createRefetchPredicate(configuredQueries?.refetchOnMount, () => true),
        refetchOnWindowFocus: createRefetchPredicate(
          configuredQueries?.refetchOnWindowFocus,
          () => true,
        ),
        refetchOnReconnect: createRefetchPredicate(
          configuredQueries?.refetchOnReconnect,
          (query) => query.options.networkMode !== 'always',
        ),
        throwOnError: createThrowOnErrorPredicate(configuredQueries?.throwOnError),
      },
    },
  });
}
