import {definitionListResponseSchema} from '@shipfox/api-definitions-dto';
import {checkedApiRequest} from '@shipfox/client-api';
import {
  type InfiniteData,
  keepPreviousData,
  queryOptions,
  type UseInfiniteQueryOptions,
  type UseQueryOptions,
  useInfiniteQuery,
  useQuery,
} from '@tanstack/react-query';
import type {DefinitionList} from '#core/definition.js';
import {toDefinitionList} from './mappers.js';

export const definitionsQueryKeys = {
  all: ['definitions'] as const,
  list: (projectId: string) => [...definitionsQueryKeys.all, 'list', projectId] as const,
};

type DefinitionListQueryKey =
  | ReturnType<typeof definitionsQueryKeys.list>
  | readonly ['definitions', 'list'];
type DefinitionListInfiniteQueryOptions = UseInfiniteQueryOptions<
  DefinitionList,
  Error,
  InfiniteData<DefinitionList, string | undefined>,
  DefinitionListQueryKey,
  string | undefined
>;
type DefinitionListQueryOptions = UseQueryOptions<
  DefinitionList,
  Error,
  DefinitionList,
  DefinitionListQueryKey
>;
export async function listDefinitions({
  projectId,
  limit = 50,
  cursor,
  signal,
}: {
  projectId: string;
  limit?: number;
  cursor?: string | undefined;
  signal?: AbortSignal | undefined;
}): Promise<DefinitionList> {
  const params = new URLSearchParams({project_id: projectId, limit: String(limit)});
  if (cursor) params.set('cursor', cursor);
  return toDefinitionList(
    await checkedApiRequest(definitionListResponseSchema, `/definitions?${params.toString()}`, {
      signal,
    }),
  );
}
export function definitionsInfiniteQueryOptions(
  projectId: string | undefined,
  limit = 50,
): DefinitionListInfiniteQueryOptions {
  return {
    queryKey: projectId
      ? definitionsQueryKeys.list(projectId)
      : ([...definitionsQueryKeys.all, 'list'] as const),
    enabled: Boolean(projectId),
    initialPageParam: undefined as string | undefined,
    queryFn: ({pageParam, signal}: {pageParam: string | undefined; signal: AbortSignal}) =>
      listDefinitions({projectId: projectId ?? '', limit, cursor: pageParam, signal}),
    getNextPageParam: (lastPage: DefinitionList) => lastPage.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  };
}
export function definitionsQueryOptions(projectId: string | undefined): DefinitionListQueryOptions {
  return queryOptions({
    queryKey: projectId
      ? definitionsQueryKeys.list(projectId)
      : ([...definitionsQueryKeys.all, 'list'] as const),
    enabled: Boolean(projectId),
    queryFn: ({signal}) => listDefinitions({projectId: projectId ?? '', signal}),
  });
}
export function useDefinitionsInfiniteQuery(projectId: string | undefined, limit = 50) {
  return useInfiniteQuery(definitionsInfiniteQueryOptions(projectId, limit));
}
export function useDefinitionsQuery(projectId: string | undefined) {
  return useQuery(definitionsQueryOptions(projectId));
}
