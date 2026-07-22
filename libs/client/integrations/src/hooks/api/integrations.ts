import type {
  IntegrationCapabilityDto,
  IntegrationConnectionDto,
  ListIntegrationConnectionsResponseDto,
  ListIntegrationProvidersResponseDto,
  ListRepositoriesResponseDto,
  UpdateIntegrationConnectionBodyDto,
} from '@shipfox/api-integration-core-dto';
import type {
  CreateGiteaConnectionBodyDto,
  CreateGiteaConnectionResponseDto,
} from '@shipfox/api-integration-gitea-dto';
import type {
  CreateGithubInstallBodyDto,
  CreateGithubInstallResponseDto,
} from '@shipfox/api-integration-github-dto';
import type {
  CreateLinearInstallBodyDto,
  CreateLinearInstallResponseDto,
  LinearCallbackQueryDto,
  LinearCallbackResponseDto,
} from '@shipfox/api-integration-linear-dto';
import type {
  CreateSentryInstallBodyDto,
  CreateSentryInstallResponseDto,
  SentryConnectBodyDto,
  SentryConnectResponseDto,
} from '@shipfox/api-integration-sentry-dto';
import type {
  CreateSlackInstallBodyDto,
  CreateSlackInstallResponseDto,
  SlackCallbackQueryDto,
  SlackCallbackResponseDto,
} from '@shipfox/api-integration-slack-dto';
import {apiRequest} from '@shipfox/client-api';
import {
  queryOptions,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {serializeLinearCallbackQuery} from '#linear-callback.js';
import {serializeSlackCallbackQuery} from '#slack-callback.js';

export const integrationsQueryKeys = {
  all: ['integrations'] as const,
  providers: (capability: IntegrationCapabilityDto | 'all') =>
    [...integrationsQueryKeys.all, 'providers', capability] as const,
  connections: (workspaceId: string, capability: IntegrationCapabilityDto | 'all') =>
    [...integrationsQueryKeys.all, 'connections', workspaceId, capability] as const,
  // Prefix matching every per-capability connections query for a workspace, so
  // a mutation can refresh all connection views without touching providers or
  // repositories.
  connectionsByWorkspace: (workspaceId: string) =>
    [...integrationsQueryKeys.all, 'connections', workspaceId] as const,
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
  const result = await listIntegrationConnections({
    workspaceId,
    capability: 'source_control',
    signal,
  });
  // The endpoint returns every lifecycle status (the settings hub needs that),
  // but source-control consumers (onboarding redirect, project creation) only
  // act on usable connections — a disabled/error one must read as "not there".
  return {
    ...result,
    connections: result.connections.filter(
      (connection) => connection.lifecycle_status === 'active',
    ),
  };
}

export function sourceConnectionsQueryOptions(workspaceId: string | undefined) {
  return queryOptions({
    queryKey: workspaceId
      ? integrationsQueryKeys.sourceConnections(workspaceId)
      : [...integrationsQueryKeys.all, 'source-connections'],
    enabled: Boolean(workspaceId),
    queryFn: ({signal}) => listSourceConnections({workspaceId: workspaceId ?? '', signal}),
  });
}

export async function createGiteaConnection(body: CreateGiteaConnectionBodyDto) {
  return await apiRequest<CreateGiteaConnectionResponseDto>('/integrations/gitea/connections', {
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

export async function createLinearInstall(body: CreateLinearInstallBodyDto) {
  return await apiRequest<CreateLinearInstallResponseDto>('/integrations/linear/install', {
    method: 'POST',
    body,
  });
}

export async function createSlackInstall(body: CreateSlackInstallBodyDto) {
  return await apiRequest<CreateSlackInstallResponseDto>('/integrations/slack/install', {
    method: 'POST',
    body,
  });
}

export async function completeLinearCallback({
  query,
  token,
}: {
  query: LinearCallbackQueryDto;
  token: string;
}) {
  return await apiRequest<LinearCallbackResponseDto>(
    `/integrations/linear/callback/api?${serializeLinearCallbackQuery(query)}`,
    {headers: {authorization: `Bearer ${token}`}},
  );
}

export async function completeSlackCallback({
  query,
  token,
}: {
  query: SlackCallbackQueryDto;
  token: string;
}) {
  return await apiRequest<SlackCallbackResponseDto>(
    `/integrations/slack/callback/api?${serializeSlackCallbackQuery(query)}`,
    {headers: {authorization: `Bearer ${token}`}},
  );
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

export async function updateIntegrationConnection({
  connectionId,
  body,
}: {
  connectionId: string;
  body: UpdateIntegrationConnectionBodyDto;
}) {
  return await apiRequest<IntegrationConnectionDto>(
    `/integration-connections/${encodeURIComponent(connectionId)}`,
    {method: 'PATCH', body},
  );
}

export async function deleteIntegrationConnection({connectionId}: {connectionId: string}) {
  await apiRequest<void>(`/integration-connections/${encodeURIComponent(connectionId)}`, {
    method: 'DELETE',
  });
}

export function useIntegrationProvidersQuery(params?: {capability?: IntegrationCapabilityDto}) {
  const capability = params?.capability;
  return useQuery({
    queryKey: integrationsQueryKeys.providers(capability ?? 'all'),
    queryFn: ({signal}) => listIntegrationProviders(capability ? {capability, signal} : {signal}),
  });
}

export function useSourceConnectionsQuery(workspaceId: string | undefined) {
  return useQuery(sourceConnectionsQueryOptions(workspaceId));
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

export function useCreateGiteaConnectionMutation() {
  return useMutation({mutationFn: createGiteaConnection});
}

export function useCreateLinearInstallMutation() {
  return useMutation({mutationFn: createLinearInstall});
}

export function useCreateSlackInstallMutation() {
  return useMutation({mutationFn: createSlackInstall});
}

export function useCompleteLinearCallbackMutation() {
  return useMutation({mutationFn: completeLinearCallback});
}

export function useCompleteSlackCallbackMutation() {
  return useMutation({mutationFn: completeSlackCallback});
}

export function useUpdateIntegrationConnectionMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateIntegrationConnection,
    onSuccess: async (connection) => {
      await queryClient.invalidateQueries({
        queryKey: integrationsQueryKeys.connectionsByWorkspace(connection.workspace_id),
      });
    },
  });
}

export function useDeleteIntegrationConnectionMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      workspaceId: _workspaceId,
      connectionId,
    }: {
      workspaceId: string;
      connectionId: string;
    }) => deleteIntegrationConnection({connectionId}),
    onSuccess: async (_result, variables) => {
      await queryClient.invalidateQueries({
        queryKey: integrationsQueryKeys.connectionsByWorkspace(variables.workspaceId),
      });
    },
  });
}
