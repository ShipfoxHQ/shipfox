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
import type {
  CreateSentryInstallBodyDto,
  CreateSentryInstallResponseDto,
  SentryConnectBodyDto,
  SentryConnectResponseDto,
} from '@shipfox/api-integration-sentry-dto';
import {apiRequest} from '@shipfox/client-api';
import {useInfiniteQuery, useMutation, useQuery} from '@tanstack/react-query';

export const integrationsQueryKeys = {
  all: ['integrations'] as const,
  providers: (capability: IntegrationCapabilityDto | 'all') =>
    [...integrationsQueryKeys.all, 'providers', capability] as const,
  connections: (workspaceId: string, capability: IntegrationCapabilityDto | 'all') =>
    [...integrationsQueryKeys.all, 'connections', workspaceId, capability] as const,
  sourceConnections: (workspaceId: string) =>
    integrationsQueryKeys.connections(workspaceId, 'source_control'),
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

export async function listIntegrationConnections({
  workspaceId,
  capability,
  signal,
}: {
  workspaceId: string;
  capability?: IntegrationCapabilityDto | undefined;
  signal?: AbortSignal | undefined;
}) {
  const search = new URLSearchParams({workspace_id: workspaceId});
  if (capability) search.set('capability', capability);
  return await apiRequest<ListIntegrationConnectionsResponseDto>(
    `/integration-connections?${search.toString()}`,
    {signal},
  );
}

export async function listSourceConnections({
  workspaceId,
  signal,
}: {
  workspaceId: string;
  signal?: AbortSignal;
}) {
  return await listIntegrationConnections({workspaceId, capability: 'source_control', signal});
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

export async function createSentryInstall(body: CreateSentryInstallBodyDto) {
  return await apiRequest<CreateSentryInstallResponseDto>('/integrations/sentry/install', {
    method: 'POST',
    body,
  });
}

// Called from the callback route with an explicit bearer (same as the GitHub
// callback): the route refreshes auth itself before forwarding the grant code.
export async function connectSentry({body, token}: {body: SentryConnectBodyDto; token: string}) {
  return await apiRequest<SentryConnectResponseDto>('/integrations/sentry/connect', {
    method: 'POST',
    body,
    headers: {authorization: `Bearer ${token}`},
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

export function useIntegrationConnectionsQuery(workspaceId: string | undefined) {
  return useQuery({
    queryKey: workspaceId
      ? integrationsQueryKeys.connections(workspaceId, 'all')
      : [...integrationsQueryKeys.all, 'connections'],
    enabled: Boolean(workspaceId),
    queryFn: ({signal}) => listIntegrationConnections({workspaceId: workspaceId ?? '', signal}),
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

export function useCreateSentryInstallMutation() {
  return useMutation({mutationFn: createSentryInstall});
}
