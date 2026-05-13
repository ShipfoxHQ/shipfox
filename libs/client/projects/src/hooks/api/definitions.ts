import type {DefinitionListResponseDto} from '@shipfox/api-definitions-dto';
import {apiRequest} from '@shipfox/client-api';
import {keepPreviousData, useInfiniteQuery, useQuery} from '@tanstack/react-query';

export const definitionsQueryKeys = {
  all: ['definitions'] as const,
  list: (projectId: string) => [...definitionsQueryKeys.all, 'list', projectId] as const,
};

export async function listDefinitions({
  projectId,
  limit = 50,
  cursor,
  signal,
}: {
  projectId: string;
  limit?: number;
  cursor?: string | undefined;
  signal?: AbortSignal;
}) {
  const params = new URLSearchParams({project_id: projectId, limit: String(limit)});
  if (cursor) params.set('cursor', cursor);
  return await apiRequest<DefinitionListResponseDto>(`/definitions?${params.toString()}`, {
    signal,
  });
}

export function useDefinitionsInfiniteQuery(projectId: string | undefined, limit = 50) {
  return useInfiniteQuery({
    queryKey: projectId
      ? definitionsQueryKeys.list(projectId)
      : [...definitionsQueryKeys.all, 'list'],
    enabled: Boolean(projectId),
    initialPageParam: undefined as string | undefined,
    queryFn: ({pageParam, signal}) =>
      listDefinitions({projectId: projectId ?? '', limit, cursor: pageParam, signal}),
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
    placeholderData: keepPreviousData,
  });
}

export function useDefinitionsQuery(projectId: string | undefined) {
  return useQuery({
    queryKey: projectId
      ? definitionsQueryKeys.list(projectId)
      : [...definitionsQueryKeys.all, 'list'],
    enabled: Boolean(projectId),
    queryFn: ({signal}) => listDefinitions({projectId: projectId ?? '', signal}),
  });
}
