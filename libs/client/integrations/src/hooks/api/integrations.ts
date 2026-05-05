import type {
  IntegrationCapabilityDto,
  IntegrationConnectionDto,
  ListIntegrationConnectionsResponseDto,
  ListIntegrationProvidersResponseDto,
  ListRepositoriesResponseDto,
} from '@shipfox/api-integration-core-dto';
import type {CreateDebugConnectionBodyDto} from '@shipfox/api-integration-debug-dto';
import type {
  CreateGithubInstallBodyDto,
  CreateGithubInstallResponseDto,
} from '@shipfox/api-integration-github-dto';
import {apiRequest} from '@shipfox/client-api';
import {useInfiniteQuery, useMutation, useQuery} from '@tanstack/react-query';

export const integrationsQueryKeys = {
  all: ['integrations'] as const,
  providers: (capability: IntegrationCapabilityDto | 'all') =>
    [...integrationsQueryKeys.all, 'providers', capability] as const,
  sourceConnections: (workspaceId: string) =>
    [...integrationsQueryKeys.all, 'source-connections', workspaceId] as const,
  repositories: (connectionId: string, search: string) =>
    [...integrationsQueryKeys.all, 'repositories', connectionId, search] as const,
};

export async function listIntegrationProviders({
  capability,
  signal,
}: {
  capability?: IntegrationCapabilityDto;
  signal?: AbortSignal;
}) {
  const search = new URLSearchParams();
  if (capability) search.set('capability', capability);
  const query = search.toString();
  const path = query ? `/integration-providers?${query}` : '/integration-providers';
  return await apiRequest<ListIntegrationProvidersResponseDto>(path, {signal});
}

export async function listSourceConnections({
  workspaceId,
  signal,
}: {
  workspaceId: string;
  signal?: AbortSignal;
}) {
  const search = new URLSearchParams({
    workspace_id: workspaceId,
    capability: 'source_control',
  });
  return await apiRequest<ListIntegrationConnectionsResponseDto>(
    `/integration-connections?${search.toString()}`,
    {signal},
  );
}

export async function createDebugConnection(body: CreateDebugConnectionBodyDto) {
  return await apiRequest<IntegrationConnectionDto>('/integrations/debug/connections', {
    method: 'POST',
    body,
  });
}

export async function createGithubInstall(body: CreateGithubInstallBodyDto) {
  return await apiRequest<CreateGithubInstallResponseDto>('/integrations/github/install', {
    method: 'POST',
    body,
  });
}

export async function listRepositories({
  connectionId,
  cursor,
  search,
  signal,
}: {
  connectionId: string;
  cursor?: string;
  search?: string;
  signal?: AbortSignal;
}) {
  const params = new URLSearchParams();
  if (cursor) params.set('cursor', cursor);
  if (search) params.set('search', search);
  const query = params.toString();
  const path = query
    ? `/integration-connections/${connectionId}/repositories?${query}`
    : `/integration-connections/${connectionId}/repositories`;
  return await apiRequest<ListRepositoriesResponseDto>(path, {signal});
}

export function useIntegrationProvidersQuery(params?: {capability?: IntegrationCapabilityDto}) {
  const capability = params?.capability;
  return useQuery({
    queryKey: integrationsQueryKeys.providers(capability ?? 'all'),
    queryFn: ({signal}) => listIntegrationProviders(capability ? {capability, signal} : {signal}),
  });
}

export function useSourceConnectionsQuery(workspaceId: string | undefined) {
  return useQuery({
    queryKey: workspaceId
      ? integrationsQueryKeys.sourceConnections(workspaceId)
      : [...integrationsQueryKeys.all, 'source-connections'],
    enabled: Boolean(workspaceId),
    queryFn: ({signal}) => listSourceConnections({workspaceId: workspaceId ?? '', signal}),
  });
}

export function useRepositoriesInfiniteQuery(
  connectionId: string | undefined,
  options?: {search?: string},
) {
  const trimmedSearch = options?.search?.trim() ?? '';
  return useInfiniteQuery({
    queryKey: connectionId
      ? integrationsQueryKeys.repositories(connectionId, trimmedSearch)
      : [...integrationsQueryKeys.all, 'repositories'],
    enabled: Boolean(connectionId),
    initialPageParam: undefined as string | undefined,
    queryFn: ({pageParam, signal}) => {
      const args: {connectionId: string; cursor?: string; search?: string; signal: AbortSignal} = {
        connectionId: connectionId ?? '',
        signal,
      };
      if (pageParam) args.cursor = pageParam;
      if (trimmedSearch) args.search = trimmedSearch;
      return listRepositories(args);
    },
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
  });
}

export function useCreateDebugConnectionMutation() {
  return useMutation({mutationFn: createDebugConnection});
}

export function useCreateGithubInstallMutation() {
  return useMutation({mutationFn: createGithubInstall});
}
