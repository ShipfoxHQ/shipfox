import type {
  CreateWebhookConnectionBodyDto,
  UpdateWebhookConnectionBodyDto,
} from '@shipfox/api-integration-webhook-dto';
import {
  listWebhookConnectionsResponseSchema,
  webhookConnectionDtoSchema,
} from '@shipfox/api-integration-webhook-dto';
import {checkedApiRequest, emptyResponseSchema} from '@shipfox/client-api';
import {
  type FetchQueryOptions,
  type QueryClient,
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import type {WebhookConnection} from '#core/models.js';
import {toWebhookConnection} from './integration-mapper.js';
import {integrationsQueryKeys} from './integrations.js';

export const webhookConnectionsQueryKeys = {
  all: ['webhook-connections'] as const,
  list: (workspaceId: string) => [...webhookConnectionsQueryKeys.all, 'list', workspaceId] as const,
};

type WebhookConnectionsListQueryKey = ReturnType<typeof webhookConnectionsQueryKeys.list>;

type WebhookConnectionsListQueryOptions = FetchQueryOptions<
  WebhookConnection[],
  Error,
  WebhookConnection[],
  WebhookConnectionsListQueryKey
>;

export async function listWebhookConnections({
  workspaceId,
  signal,
}: {
  workspaceId: string;
  signal?: AbortSignal;
}) {
  const search = new URLSearchParams({workspace_id: workspaceId});
  const response = await checkedApiRequest(
    listWebhookConnectionsResponseSchema,
    `/integrations/webhook/connections?${search.toString()}`,
    {signal},
  );
  return response.connections.map(toWebhookConnection);
}

export async function createWebhookConnection(body: CreateWebhookConnectionBodyDto) {
  const response = await checkedApiRequest(
    webhookConnectionDtoSchema,
    '/integrations/webhook/connections',
    {
      method: 'POST',
      body,
    },
  );
  return toWebhookConnection(response);
}

export async function updateWebhookConnection({
  connectionId,
  body,
}: {
  connectionId: string;
  body: UpdateWebhookConnectionBodyDto;
}) {
  const response = await checkedApiRequest(
    webhookConnectionDtoSchema,
    `/integrations/webhook/connections/${encodeURIComponent(connectionId)}`,
    {method: 'PATCH', body},
  );
  return toWebhookConnection(response);
}

export async function deleteWebhookConnection({connectionId}: {connectionId: string}) {
  await checkedApiRequest(
    emptyResponseSchema,
    `/integrations/webhook/connections/${encodeURIComponent(connectionId)}`,
    {
      method: 'DELETE',
    },
  );
}

export function useWebhookConnectionsQuery(workspaceId: string | undefined) {
  return useQuery({
    queryKey: workspaceId
      ? webhookConnectionsQueryKeys.list(workspaceId)
      : [...webhookConnectionsQueryKeys.all, 'list'],
    enabled: Boolean(workspaceId),
    queryFn: ({signal}) => listWebhookConnections({workspaceId: workspaceId ?? '', signal}),
  });
}

export function webhookConnectionsQueryOptions(
  workspaceId: string,
): WebhookConnectionsListQueryOptions {
  return queryOptions({
    queryKey: webhookConnectionsQueryKeys.list(workspaceId),
    queryFn: ({signal}) => listWebhookConnections({workspaceId, signal}),
  });
}

export function useCreateWebhookConnectionMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createWebhookConnection,
    onSuccess: async (connection) => {
      await invalidateWebhookConnectionViews(queryClient, connection.workspaceId);
    },
  });
}

export function useUpdateWebhookConnectionMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      connectionId,
      body,
    }: {
      workspaceId: string;
      connectionId: string;
      body: UpdateWebhookConnectionBodyDto;
    }) => updateWebhookConnection({connectionId, body}),
    onSuccess: async (connection) => {
      await invalidateWebhookConnectionViews(queryClient, connection.workspaceId);
    },
  });
}

export function useDeleteWebhookConnectionMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({connectionId}: {workspaceId: string; connectionId: string}) =>
      deleteWebhookConnection({connectionId}),
    onSuccess: async (_result, variables) => {
      await invalidateWebhookConnectionViews(queryClient, variables.workspaceId);
    },
  });
}

async function invalidateWebhookConnectionViews(queryClient: QueryClient, workspaceId: string) {
  await Promise.all([
    queryClient.invalidateQueries({
      queryKey: webhookConnectionsQueryKeys.list(workspaceId),
      refetchType: 'all',
    }),
    queryClient.invalidateQueries({
      queryKey: integrationsQueryKeys.connectionsByWorkspace(workspaceId),
      refetchType: 'all',
    }),
  ]);
}
