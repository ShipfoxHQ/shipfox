import {
  customModelProviderConfigDtoSchema,
  discoverCustomModelProviderModelsResponseSchema,
  listModelProviderConfigsResponseSchema,
  type ModelProviderRef,
  modelProviderCatalogResponseSchema,
  modelProviderConfigDtoSchema,
  setDefaultHarnessResponseSchema,
  setDefaultModelProviderResponseSchema,
} from '@shipfox/api-agent-dto';
import {checkedApiRequest, emptyResponseSchema} from '@shipfox/client-api';
import {
  type FetchQueryOptions,
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import type {
  AgentModel,
  CreateCustomProviderCommand,
  DiscoverProviderModelsCommand,
  HarnessId,
  ProviderCatalog,
  ProviderConfig,
  ProviderConfiguration,
  ProviderCredentialsCommand,
  UpdateCustomProviderCommand,
} from '#core/models.js';
import {
  toCreateCustomProviderBody,
  toDefaultHarnessBody,
  toDefaultModelBody,
  toDefaultProviderBody,
  toDiscoverModelsBody,
  toDiscoverModelsBySlugBody,
  toProviderCredentialsBody,
  toUpdateCustomProviderBody,
} from './model-provider-command-mapper.js';
import {
  toProviderCatalog,
  toProviderConfig,
  toProviderConfiguration,
} from './model-provider-mapper.js';

export const modelProviderQueryKeys = {
  all: ['model-providers'] as const,
  catalog: () => [...modelProviderQueryKeys.all, 'catalog'] as const,
  configs: (workspaceId: string) =>
    [...modelProviderQueryKeys.all, 'configs', workspaceId] as const,
};

type ModelProviderConfigsQueryKey =
  | ReturnType<typeof modelProviderQueryKeys.configs>
  | readonly ['model-providers', 'configs'];

type ModelProviderConfigsQueryOptions = FetchQueryOptions<
  ProviderConfiguration,
  Error,
  ProviderConfiguration,
  ModelProviderConfigsQueryKey
>;

export async function getModelProviderCatalog({
  signal,
}: {
  signal?: AbortSignal;
} = {}): Promise<ProviderCatalog> {
  return toProviderCatalog(
    await checkedApiRequest(modelProviderCatalogResponseSchema, '/agent/model-provider-catalog', {
      signal,
    }),
  );
}

export async function listModelProviderConfigs({
  workspaceId,
  signal,
}: {
  workspaceId: string;
  signal?: AbortSignal;
}): Promise<ProviderConfiguration> {
  return toProviderConfiguration(
    await checkedApiRequest(
      listModelProviderConfigsResponseSchema,
      `/workspaces/${workspaceId}/agent/model-providers`,
      {signal},
    ),
  );
}

export function modelProviderConfigsQueryOptions(
  workspaceId: string | undefined,
): ModelProviderConfigsQueryOptions {
  return queryOptions({
    queryKey: workspaceId
      ? modelProviderQueryKeys.configs(workspaceId)
      : ([...modelProviderQueryKeys.all, 'configs'] as const),
    enabled: Boolean(workspaceId),
    queryFn: ({signal}) => listModelProviderConfigs({workspaceId: workspaceId ?? '', signal}),
  });
}

export async function upsertModelProviderConfig({
  workspaceId,
  providerId,
  command,
}: {
  workspaceId: string;
  providerId: string;
  command: ProviderCredentialsCommand;
}): Promise<ProviderConfig> {
  return toProviderConfig(
    await checkedApiRequest(
      modelProviderConfigDtoSchema,
      `/workspaces/${workspaceId}/agent/model-providers/${providerId}`,
      {method: 'PUT', body: toProviderCredentialsBody(command)},
    ),
  );
}

export async function createCustomModelProviderConfig({
  workspaceId,
  command,
}: {
  workspaceId: string;
  command: CreateCustomProviderCommand;
}): Promise<ProviderConfig> {
  return toProviderConfig(
    await checkedApiRequest(
      customModelProviderConfigDtoSchema,
      `/workspaces/${workspaceId}/agent/custom-model-providers`,
      {method: 'POST', body: toCreateCustomProviderBody(command)},
    ),
  );
}

export async function updateCustomModelProviderConfig({
  workspaceId,
  providerId,
  command,
}: {
  workspaceId: string;
  providerId: ModelProviderRef;
  command: UpdateCustomProviderCommand;
}): Promise<ProviderConfig> {
  return toProviderConfig(
    await checkedApiRequest(
      customModelProviderConfigDtoSchema,
      `/workspaces/${workspaceId}/agent/custom-model-providers/${providerId}`,
      {method: 'PUT', body: toUpdateCustomProviderBody(command)},
    ),
  );
}

export async function discoverCustomModelProviderModels({
  workspaceId,
  command,
}: {
  workspaceId: string;
  command: DiscoverProviderModelsCommand;
}): Promise<readonly AgentModel[]> {
  const response = await checkedApiRequest(
    discoverCustomModelProviderModelsResponseSchema,
    `/workspaces/${workspaceId}/agent/custom-model-providers/discover-models`,
    {method: 'POST', body: toDiscoverModelsBody(command)},
  );
  return response.models.map((model) => ({id: model.id, label: model.label}));
}

export async function discoverCustomModelProviderModelsBySlug({
  workspaceId,
  providerId,
  command,
}: {
  workspaceId: string;
  providerId: ModelProviderRef;
  command: DiscoverProviderModelsCommand;
}): Promise<readonly AgentModel[]> {
  const response = await checkedApiRequest(
    discoverCustomModelProviderModelsResponseSchema,
    `/workspaces/${workspaceId}/agent/custom-model-providers/${providerId}/discover-models`,
    {method: 'POST', body: toDiscoverModelsBySlugBody(command)},
  );
  return response.models.map((model) => ({id: model.id, label: model.label}));
}

export async function deleteModelProviderConfig({
  workspaceId,
  providerId,
}: {
  workspaceId: string;
  providerId: ModelProviderRef;
}) {
  return await checkedApiRequest(
    emptyResponseSchema,
    `/workspaces/${workspaceId}/agent/model-providers/${providerId}`,
    {method: 'DELETE'},
  );
}

export async function updateModelProviderDefaultModel({
  workspaceId,
  providerId,
  defaultModel,
}: {
  workspaceId: string;
  providerId: string;
  defaultModel: string | null;
}): Promise<ProviderConfig> {
  return toProviderConfig(
    await checkedApiRequest(
      modelProviderConfigDtoSchema,
      `/workspaces/${workspaceId}/agent/model-providers/${providerId}/default-model`,
      {method: 'PUT', body: toDefaultModelBody(defaultModel)},
    ),
  );
}

export async function setDefaultModelProvider({
  workspaceId,
  providerId,
}: {
  workspaceId: string;
  providerId: string;
}) {
  return await checkedApiRequest(
    setDefaultModelProviderResponseSchema,
    `/workspaces/${workspaceId}/agent/default-model-provider`,
    {method: 'PUT', body: toDefaultProviderBody(providerId)},
  );
}

export async function setDefaultHarness({
  workspaceId,
  harnessId,
}: {
  workspaceId: string;
  harnessId: HarnessId;
}) {
  return await checkedApiRequest(
    setDefaultHarnessResponseSchema,
    `/workspaces/${workspaceId}/agent/default-harness`,
    {method: 'PUT', body: toDefaultHarnessBody(harnessId)},
  );
}

export function useModelProviderCatalogQuery() {
  return useQuery(modelProviderCatalogQueryOptions());
}

export function modelProviderCatalogQueryOptions() {
  return queryOptions({
    queryKey: modelProviderQueryKeys.catalog(),
    queryFn: ({signal}) => getModelProviderCatalog({signal}),
    staleTime: 1000 * 60 * 60,
  });
}

export function useModelProviderConfigsQuery(workspaceId: string | undefined) {
  return useQuery(modelProviderConfigsQueryOptions(workspaceId));
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
