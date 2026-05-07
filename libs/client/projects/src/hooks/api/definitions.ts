import type {DefinitionListResponseDto} from '@shipfox/api-definitions-dto';
import {apiRequest} from '@shipfox/client-api';
import {useQuery} from '@tanstack/react-query';

export const definitionsQueryKeys = {
  all: ['definitions'] as const,
  list: (projectId: string) => [...definitionsQueryKeys.all, 'list', projectId] as const,
};

export async function listDefinitions({
  projectId,
  signal,
}: {
  projectId: string;
  signal?: AbortSignal;
}) {
  const params = new URLSearchParams({project_id: projectId});
  return await apiRequest<DefinitionListResponseDto>(`/definitions?${params.toString()}`, {
    signal,
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
