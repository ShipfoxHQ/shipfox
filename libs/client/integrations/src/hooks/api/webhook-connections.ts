import type {
  CreateWebhookConnectionBodyDto,
  ListWebhookConnectionsResponseDto,
  UpdateWebhookConnectionBodyDto,
  WebhookConnectionDto,
} from '@shipfox/api-integration-webhook-dto';
import {apiRequest} from '@shipfox/client-api';
import {type QueryClient, useMutation, useQuery, useQueryClient} from '@tanstack/react-query';
import {integrationsQueryKeys} from './integrations.js';

export const webhookConnectionsQueryKeys = {
  all: ['webhook-connections'] as const,
  list: (workspaceId: string) => [...webhookConnectionsQueryKeys.all, 'list', workspaceId] as const,
};

export async function listWebhookConnections({
  workspaceId,
  signal,
}: {
  workspaceId: string;
  signal?: AbortSignal;
}) {
  const search = new URLSearchParams({workspace_id: workspaceId});
  return await apiRequest<ListWebhookConnectionsResponseDto>(
    `/integrations/webhook/connections?${search.toString()}`,
    {signal},
  );
}

export async function createWebhookConnection(body: CreateWebhookConnectionBodyDto) {
  return await apiRequest<WebhookConnectionDto>('/integrations/webhook/connections', {
    method: 'POST',
    body,
  });
}

export async function updateWebhookConnection({
  connectionId,
  body,
}: {
  connectionId: string;
  body: UpdateWebhookConnectionBodyDto;
}) {
  return await apiRequest<WebhookConnectionDto>(
    `/integrations/webhook/connections/${encodeURIComponent(connectionId)}`,
    {method: 'PATCH', body},
  );
}

export async function deleteWebhookConnection({connectionId}: {connectionId: string}) {
  await apiRequest<void>(`/integrations/webhook/connections/${encodeURIComponent(connectionId)}`, {
    method: 'DELETE',
  });
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

export function useCreateWebhookConnectionMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createWebhookConnection,
    onSuccess: async (connection) => {
      await invalidateWebhookConnectionViews(queryClient, connection.workspace_id);
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
      await invalidateWebhookConnectionViews(queryClient, connection.workspace_id);
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
