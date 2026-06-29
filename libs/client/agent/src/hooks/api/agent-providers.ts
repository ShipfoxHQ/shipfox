import type {
  AgentProviderCatalogResponseDto,
  AgentProviderConfigDto,
  ListAgentProviderConfigsResponseDto,
  SetDefaultAgentProviderBodyDto,
  SetDefaultAgentProviderResponseDto,
  SupportedAgentProviderId,
  UpdateAgentProviderConfigBodyDto,
  UpdateAgentProviderDefaultModelBodyDto,
} from '@shipfox/api-agent-dto';
import {apiRequest} from '@shipfox/client-api';
import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';

export const agentProviderQueryKeys = {
  all: ['agent-providers'] as const,
  catalog: () => [...agentProviderQueryKeys.all, 'catalog'] as const,
  configs: (workspaceId: string) =>
    [...agentProviderQueryKeys.all, 'configs', workspaceId] as const,
};

export async function getAgentProviderCatalog({signal}: {signal?: AbortSignal} = {}) {
  return await apiRequest<AgentProviderCatalogResponseDto>('/agent/provider-catalog', {signal});
}

export async function listAgentProviderConfigs({
  workspaceId,
  signal,
}: {
  workspaceId: string;
  signal?: AbortSignal;
}) {
  return await apiRequest<ListAgentProviderConfigsResponseDto>(
    `/workspaces/${workspaceId}/agent/providers`,
    {signal},
  );
}

export async function upsertAgentProviderConfig({
  workspaceId,
  providerId,
  body,
}: {
  workspaceId: string;
  providerId: SupportedAgentProviderId;
  body: UpdateAgentProviderConfigBodyDto;
}) {
  return await apiRequest<AgentProviderConfigDto>(
    `/workspaces/${workspaceId}/agent/providers/${providerId}`,
    {method: 'PUT', body},
  );
}

export async function deleteAgentProviderConfig({
  workspaceId,
  providerId,
}: {
  workspaceId: string;
  providerId: SupportedAgentProviderId;
}) {
  return await apiRequest<void>(`/workspaces/${workspaceId}/agent/providers/${providerId}`, {
    method: 'DELETE',
  });
}

export async function updateAgentProviderDefaultModel({
  workspaceId,
  providerId,
  body,
}: {
  workspaceId: string;
  providerId: SupportedAgentProviderId;
  body: UpdateAgentProviderDefaultModelBodyDto;
}) {
  return await apiRequest<AgentProviderConfigDto>(
    `/workspaces/${workspaceId}/agent/providers/${providerId}/default-model`,
    {method: 'PUT', body},
  );
}

export async function setDefaultAgentProvider({
  workspaceId,
  body,
}: {
  workspaceId: string;
  body: SetDefaultAgentProviderBodyDto;
}) {
  return await apiRequest<SetDefaultAgentProviderResponseDto>(
    `/workspaces/${workspaceId}/agent/default-provider`,
    {method: 'PUT', body},
  );
}

export function useAgentProviderCatalogQuery() {
  return useQuery({
    queryKey: agentProviderQueryKeys.catalog(),
    queryFn: ({signal}) => getAgentProviderCatalog({signal}),
    staleTime: 1000 * 60 * 60,
  });
}

export function useAgentProviderConfigsQuery(workspaceId: string | undefined) {
  return useQuery({
    queryKey: workspaceId
      ? agentProviderQueryKeys.configs(workspaceId)
      : [...agentProviderQueryKeys.all, 'configs'],
    enabled: Boolean(workspaceId),
    queryFn: ({signal}) => listAgentProviderConfigs({workspaceId: workspaceId ?? '', signal}),
  });
}

export function useUpsertAgentProviderConfigMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: upsertAgentProviderConfig,
    onSuccess: async (_config, variables) => {
      await queryClient.invalidateQueries({
        queryKey: agentProviderQueryKeys.configs(variables.workspaceId),
      });
    },
  });
}

export function useDeleteAgentProviderConfigMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteAgentProviderConfig,
    onSuccess: async (_config, variables) => {
      await queryClient.invalidateQueries({
        queryKey: agentProviderQueryKeys.configs(variables.workspaceId),
      });
    },
  });
}

export function useUpdateAgentProviderDefaultModelMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateAgentProviderDefaultModel,
    onSuccess: async (_config, variables) => {
      await queryClient.invalidateQueries({
        queryKey: agentProviderQueryKeys.configs(variables.workspaceId),
      });
    },
  });
}

export function useSetDefaultAgentProviderMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: setDefaultAgentProvider,
    onSuccess: async (_config, variables) => {
      await queryClient.invalidateQueries({
        queryKey: agentProviderQueryKeys.configs(variables.workspaceId),
      });
    },
  });
}
