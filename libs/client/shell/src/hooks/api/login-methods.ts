import {loginMethodsResponseSchema} from '@shipfox/api-auth-dto';
import {checkedApiRequest} from '@shipfox/client-api';
import {type FetchQueryOptions, queryOptions, useQuery} from '@tanstack/react-query';

export const loginMethodsQueryKey = ['auth', 'login-methods'] as const;

type LoginMethodsQueryOptions = FetchQueryOptions<
  string[],
  Error,
  string[],
  typeof loginMethodsQueryKey
>;

export async function listLoginMethods(signal?: AbortSignal): Promise<string[]> {
  const response = await checkedApiRequest(loginMethodsResponseSchema, '/auth/login-methods', {
    signal,
  });
  return response.login_methods.map(({id}) => id);
}

export function loginMethodsQueryOptions(): LoginMethodsQueryOptions {
  return queryOptions({
    queryKey: loginMethodsQueryKey,
    queryFn: ({signal}) => listLoginMethods(signal),
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
  });
}

/** Login method ids the server composition offers, such as `password` or `oauth:github`. */
export function useLoginMethods() {
  return useQuery(loginMethodsQueryOptions());
}
