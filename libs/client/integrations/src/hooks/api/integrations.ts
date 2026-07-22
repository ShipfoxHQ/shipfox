import type {
  IntegrationCapabilityDto,
  UpdateIntegrationConnectionBodyDto,
} from '@shipfox/api-integration-core-dto';
import {
  integrationConnectionDtoSchema,
  listIntegrationConnectionsResponseSchema,
  listIntegrationProvidersResponseSchema,
  listRepositoriesResponseSchema,
} from '@shipfox/api-integration-core-dto';
import type {CreateGiteaConnectionBodyDto} from '@shipfox/api-integration-gitea-dto';
import {createGiteaConnectionResponseSchema} from '@shipfox/api-integration-gitea-dto';
import type {CreateGithubInstallBodyDto} from '@shipfox/api-integration-github-dto';
import {
  createGithubInstallResponseSchema,
  githubCallbackResponseSchema,
} from '@shipfox/api-integration-github-dto';
import type {
  CreateLinearInstallBodyDto,
  LinearCallbackQueryDto,
} from '@shipfox/api-integration-linear-dto';
import {
  createLinearInstallResponseSchema,
  linearCallbackResponseSchema,
} from '@shipfox/api-integration-linear-dto';
import type {
  CreateSentryInstallBodyDto,
  SentryConnectBodyDto,
} from '@shipfox/api-integration-sentry-dto';
import {
  createSentryInstallResponseSchema,
  sentryConnectResponseSchema,
} from '@shipfox/api-integration-sentry-dto';
import type {
  CreateSlackInstallBodyDto,
  SlackCallbackQueryDto,
} from '@shipfox/api-integration-slack-dto';
import {
  createSlackInstallResponseSchema,
  slackCallbackResponseSchema,
} from '@shipfox/api-integration-slack-dto';
import {checkedApiRequest, emptyResponseSchema} from '@shipfox/client-api';
import {
  type FetchQueryOptions,
  queryOptions,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  type IntegrationConnection,
  type IntegrationProvider,
  isUsableConnection,
} from '#core/models.js';
import {serializeLinearCallbackQuery} from '#linear-callback.js';
import {serializeSlackCallbackQuery} from '#slack-callback.js';
import {
  toIntegrationConnection,
  toIntegrationProvider,
  toRepository,
} from './integration-mapper.js';

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

type SourceConnectionsQueryKey =
  | ReturnType<typeof integrationsQueryKeys.sourceConnections>
  | readonly ['integrations', 'source-connections'];

type SourceConnectionsQueryOptions = FetchQueryOptions<
  IntegrationConnection[],
  Error,
  IntegrationConnection[],
  SourceConnectionsQueryKey
>;

type ProvidersQueryKey = ReturnType<typeof integrationsQueryKeys.providers>;

type ProvidersQueryOptions = FetchQueryOptions<
  IntegrationProvider[],
  Error,
  IntegrationProvider[],
  ProvidersQueryKey
>;

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
  const response = await checkedApiRequest(listIntegrationProvidersResponseSchema, path, {signal});
  return response.providers.map(toIntegrationProvider);
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
  const response = await checkedApiRequest(
    listIntegrationConnectionsResponseSchema,
    `/integration-connections?${search.toString()}`,
    {signal},
  );
  return response.connections.map(toIntegrationConnection);
}

export async function listSourceConnections({
  workspaceId,
  signal,
}: {
  workspaceId: string;
  signal?: AbortSignal;
}) {
  const connections = await listIntegrationConnections({
    workspaceId,
    capability: 'source_control',
    signal,
  });
  // The endpoint returns every lifecycle status (the settings hub needs that),
  // but source-control consumers (onboarding redirect, project creation) only
  // act on usable connections — a disabled/error one must read as "not there".
  return connections.filter(isUsableConnection);
}

export function sourceConnectionsQueryOptions(
  workspaceId: string | undefined,
): SourceConnectionsQueryOptions {
  return queryOptions({
    queryKey: workspaceId
      ? integrationsQueryKeys.sourceConnections(workspaceId)
      : ([...integrationsQueryKeys.all, 'source-connections'] as const),
    enabled: Boolean(workspaceId),
    queryFn: ({signal}) => listSourceConnections({workspaceId: workspaceId ?? '', signal}),
  });
}

export async function createGiteaConnection(body: CreateGiteaConnectionBodyDto) {
  const response = await checkedApiRequest(
    createGiteaConnectionResponseSchema,
    '/integrations/gitea/connections',
    {
      method: 'POST',
      body,
    },
  );
  return toIntegrationConnection(response);
}

export async function createGithubInstall(body: CreateGithubInstallBodyDto) {
  return await checkedApiRequest(
    createGithubInstallResponseSchema,
    '/integrations/github/install',
    {
      method: 'POST',
      body,
    },
  );
}

export async function completeGithubCallback({
  code,
  installationId,
  state,
  setupAction,
  token,
}: {
  code: string;
  installationId: number;
  state: string;
  setupAction?: string;
  token: string;
}) {
  const query = new URLSearchParams({code, installation_id: String(installationId), state});
  if (setupAction) query.set('setup_action', setupAction);
  const response = await checkedApiRequest(
    githubCallbackResponseSchema,
    `/integrations/github/callback/api?${query.toString()}`,
    {headers: {authorization: `Bearer ${token}`}},
  );
  return toIntegrationConnection(response);
}

export async function createSentryInstall(body: CreateSentryInstallBodyDto) {
  return await checkedApiRequest(
    createSentryInstallResponseSchema,
    '/integrations/sentry/install',
    {
      method: 'POST',
      body,
    },
  );
}

export async function createLinearInstall(body: CreateLinearInstallBodyDto) {
  return await checkedApiRequest(
    createLinearInstallResponseSchema,
    '/integrations/linear/install',
    {
      method: 'POST',
      body,
    },
  );
}

export async function createSlackInstall(body: CreateSlackInstallBodyDto) {
  return await checkedApiRequest(createSlackInstallResponseSchema, '/integrations/slack/install', {
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
  const response = await checkedApiRequest(
    linearCallbackResponseSchema,
    `/integrations/linear/callback/api?${serializeLinearCallbackQuery(query)}`,
    {headers: {authorization: `Bearer ${token}`}},
  );
  return toIntegrationConnection(response);
}

export async function completeSlackCallback({
  query,
  token,
}: {
  query: SlackCallbackQueryDto;
  token: string;
}) {
  const response = await checkedApiRequest(
    slackCallbackResponseSchema,
    `/integrations/slack/callback/api?${serializeSlackCallbackQuery(query)}`,
    {headers: {authorization: `Bearer ${token}`}},
  );
  return toIntegrationConnection(response);
}

// Called from the callback route with an explicit bearer (same as the GitHub
// callback): the route refreshes auth itself before forwarding the grant code.
export async function connectSentry({body, token}: {body: SentryConnectBodyDto; token: string}) {
  const response = await checkedApiRequest(
    sentryConnectResponseSchema,
    '/integrations/sentry/connect',
    {
      method: 'POST',
      body,
      headers: {authorization: `Bearer ${token}`},
    },
  );
  return toIntegrationConnection(response);
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
  const response = await checkedApiRequest(listRepositoriesResponseSchema, path, {signal});
  return {
    repositories: response.repositories.map(toRepository),
    nextCursor: response.next_cursor ?? undefined,
  };
}

export async function updateIntegrationConnection({
  connectionId,
  body,
}: {
  connectionId: string;
  body: UpdateIntegrationConnectionBodyDto;
}) {
  const response = await checkedApiRequest(
    integrationConnectionDtoSchema,
    `/integration-connections/${encodeURIComponent(connectionId)}`,
    {method: 'PATCH', body},
  );
  return toIntegrationConnection(response);
}

export async function deleteIntegrationConnection({connectionId}: {connectionId: string}) {
  await checkedApiRequest(
    emptyResponseSchema,
    `/integration-connections/${encodeURIComponent(connectionId)}`,
    {
      method: 'DELETE',
    },
  );
}

export function useIntegrationProvidersQuery(params?: {capability?: IntegrationCapabilityDto}) {
  const capability = params?.capability;
  return useQuery({
    queryKey: integrationsQueryKeys.providers(capability ?? 'all'),
    queryFn: ({signal}) => listIntegrationProviders(capability ? {capability, signal} : {signal}),
  });
}

export function integrationProvidersQueryOptions(
  capability?: IntegrationCapabilityDto,
): ProvidersQueryOptions {
  return queryOptions({
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
    getNextPageParam: (lastPage) => lastPage.nextCursor,
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
        queryKey: integrationsQueryKeys.connectionsByWorkspace(connection.workspaceId),
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
