import type {
  CreateCustomModelProviderBodyDto,
  CustomModelProviderConfigDto,
  DiscoverCustomModelProviderModelsBodyDto,
  DiscoverCustomModelProviderModelsBySlugBodyDto,
  DiscoverCustomModelProviderModelsResponseDto,
  ListModelProviderConfigsResponseDto,
  ModelProviderCatalogResponseDto,
  ModelProviderConfigDto,
  ModelProviderRef,
  SetDefaultHarnessBodyDto,
  SetDefaultHarnessResponseDto,
  SetDefaultModelProviderBodyDto,
  SetDefaultModelProviderResponseDto,
  SupportedModelProviderId,
  UpdateCustomModelProviderBodyDto,
  UpdateModelProviderConfigBodyDto,
  UpdateModelProviderDefaultModelBodyDto,
} from '@shipfox/api-agent-dto';
import {apiRequest} from '@shipfox/client-api';
import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';

export const modelProviderQueryKeys = {
  all: ['model-providers'] as const,
  catalog: () => [...modelProviderQueryKeys.all, 'catalog'] as const,
  configs: (workspaceId: string) =>
    [...modelProviderQueryKeys.all, 'configs', workspaceId] as const,
};

export async function getModelProviderCatalog({signal}: {signal?: AbortSignal} = {}) {
  return await apiRequest<ModelProviderCatalogResponseDto>('/agent/model-provider-catalog', {
    signal,
  });
}

export async function listModelProviderConfigs({
  workspaceId,
  signal,
}: {
  workspaceId: string;
  signal?: AbortSignal;
}) {
  return await apiRequest<ListModelProviderConfigsResponseDto>(
    `/workspaces/${workspaceId}/agent/model-providers`,
    {signal},
  );
}

export async function upsertModelProviderConfig({
  workspaceId,
  providerId,
  body,
}: {
  workspaceId: string;
  providerId: SupportedModelProviderId;
  body: UpdateModelProviderConfigBodyDto;
}) {
  return await apiRequest<ModelProviderConfigDto>(
    `/workspaces/${workspaceId}/agent/model-providers/${providerId}`,
    {method: 'PUT', body},
  );
}

export async function createCustomModelProviderConfig({
  workspaceId,
  body,
}: {
  workspaceId: string;
  body: CreateCustomModelProviderBodyDto;
}) {
  return await apiRequest<CustomModelProviderConfigDto>(
    `/workspaces/${workspaceId}/agent/custom-model-providers`,
    {method: 'POST', body},
  );
}

export async function updateCustomModelProviderConfig({
  workspaceId,
  providerId,
  body,
}: {
  workspaceId: string;
  providerId: ModelProviderRef;
  body: UpdateCustomModelProviderBodyDto;
}) {
  return await apiRequest<CustomModelProviderConfigDto>(
    `/workspaces/${workspaceId}/agent/custom-model-providers/${providerId}`,
    {method: 'PUT', body},
  );
}

export async function discoverCustomModelProviderModels({
  workspaceId,
  body,
}: {
  workspaceId: string;
  body: DiscoverCustomModelProviderModelsBodyDto;
}) {
  return await apiRequest<DiscoverCustomModelProviderModelsResponseDto>(
    `/workspaces/${workspaceId}/agent/custom-model-providers/discover-models`,
    {method: 'POST', body},
  );
}

export async function discoverCustomModelProviderModelsBySlug({
  workspaceId,
  providerId,
  body,
}: {
  workspaceId: string;
  providerId: ModelProviderRef;
  body: DiscoverCustomModelProviderModelsBySlugBodyDto;
}) {
  return await apiRequest<DiscoverCustomModelProviderModelsResponseDto>(
    `/workspaces/${workspaceId}/agent/custom-model-providers/${providerId}/discover-models`,
    {method: 'POST', body},
  );
}

export async function deleteModelProviderConfig({
  workspaceId,
  providerId,
}: {
  workspaceId: string;
  providerId: ModelProviderRef;
}) {
  return await apiRequest<void>(`/workspaces/${workspaceId}/agent/model-providers/${providerId}`, {
    method: 'DELETE',
  });
}

export async function updateModelProviderDefaultModel({
  workspaceId,
  providerId,
  body,
}: {
  workspaceId: string;
  providerId: SupportedModelProviderId;
  body: UpdateModelProviderDefaultModelBodyDto;
}) {
  return await apiRequest<ModelProviderConfigDto>(
    `/workspaces/${workspaceId}/agent/model-providers/${providerId}/default-model`,
    {method: 'PUT', body},
  );
}

export async function setDefaultModelProvider({
  workspaceId,
  body,
}: {
  workspaceId: string;
  body: SetDefaultModelProviderBodyDto;
}) {
  return await apiRequest<SetDefaultModelProviderResponseDto>(
    `/workspaces/${workspaceId}/agent/default-model-provider`,
    {method: 'PUT', body},
  );
}

export async function setDefaultHarness({
  workspaceId,
  body,
}: {
  workspaceId: string;
  body: SetDefaultHarnessBodyDto;
}) {
  return await apiRequest<SetDefaultHarnessResponseDto>(
    `/workspaces/${workspaceId}/agent/default-harness`,
    {method: 'PUT', body},
  );
}

export function useModelProviderCatalogQuery() {
  return useQuery({
    queryKey: modelProviderQueryKeys.catalog(),
    queryFn: ({signal}) => getModelProviderCatalog({signal}),
    staleTime: 1000 * 60 * 60,
  });
}

export function useModelProviderConfigsQuery(workspaceId: string | undefined) {
  return useQuery({
    queryKey: workspaceId
      ? modelProviderQueryKeys.configs(workspaceId)
      : [...modelProviderQueryKeys.all, 'configs'],
    enabled: Boolean(workspaceId),
    queryFn: ({signal}) => listModelProviderConfigs({workspaceId: workspaceId ?? '', signal}),
  });
}

export function useUpsertModelProviderConfigMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: upsertModelProviderConfig,
    onSuccess: async (_config, variables) => {
      await queryClient.invalidateQueries({
        queryKey: modelProviderQueryKeys.configs(variables.workspaceId),
      });
    },
  });
}

export function useCreateCustomModelProviderMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createCustomModelProviderConfig,
    onSuccess: async (_config, variables) => {
      await queryClient.invalidateQueries({
        queryKey: modelProviderQueryKeys.configs(variables.workspaceId),
      });
    },
  });
}

export function useUpdateCustomModelProviderMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateCustomModelProviderConfig,
    onSuccess: async (_config, variables) => {
      await queryClient.invalidateQueries({
        queryKey: modelProviderQueryKeys.configs(variables.workspaceId),
      });
    },
  });
}

export function useDiscoverCustomModelProviderModelsMutation() {
  return useMutation({mutationFn: discoverCustomModelProviderModels});
}

export function useDiscoverCustomModelProviderModelsBySlugMutation() {
  return useMutation({mutationFn: discoverCustomModelProviderModelsBySlug});
}

export function useDeleteModelProviderConfigMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteModelProviderConfig,
    onSuccess: async (_config, variables) => {
      await queryClient.invalidateQueries({
        queryKey: modelProviderQueryKeys.configs(variables.workspaceId),
      });
    },
  });
}

export function useUpdateModelProviderDefaultModelMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateModelProviderDefaultModel,
    onSuccess: async (_config, variables) => {
      await queryClient.invalidateQueries({
        queryKey: modelProviderQueryKeys.configs(variables.workspaceId),
      });
    },
  });
}

export function useSetDefaultModelProviderMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: setDefaultModelProvider,
    onSuccess: async (_config, variables) => {
      await queryClient.invalidateQueries({
        queryKey: modelProviderQueryKeys.configs(variables.workspaceId),
      });
    },
  });
}

export function useSetDefaultHarnessMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: setDefaultHarness,
    onSuccess: async (_config, variables) => {
      await queryClient.invalidateQueries({
        queryKey: modelProviderQueryKeys.configs(variables.workspaceId),
      });
    },
  });
}
