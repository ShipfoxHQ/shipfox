import {SECRETS_MAX_LIST_LIMIT} from '@shipfox/api-secrets-dto';
import {
  apiRequest,
  checkedApiRequest,
  type StandardSchema,
  type StandardSchemaOutput,
} from '@shipfox/client-api';
import {queryOptions, useMutation, useQuery, useQueryClient} from '@tanstack/react-query';
import {
  type DeleteStoreCommand,
  type PutStoreCommand,
  projectIdFromScope,
  type StoreScope,
  type StoreWriteWarning,
  workspaceStoreScope,
} from '#core/store.js';

type StoreApiConfig<
  TListItem,
  TPutItem,
  TListSchema extends StandardSchema,
  TPutSchema extends StandardSchema,
> = {
  resource: 'secrets' | 'variables';
  listResponseSchema: TListSchema;
  putResponseSchema: TPutSchema;
  toListItems: (response: StandardSchemaOutput<TListSchema>) => TListItem[];
  toPutResult: (response: StandardSchemaOutput<TPutSchema>) => {
    item: TPutItem;
    warnings: StoreWriteWarning[];
  };
};

export function createStoreApi<
  TListItem,
  TPutItem,
  TListSchema extends StandardSchema,
  TPutSchema extends StandardSchema,
>(config: StoreApiConfig<TListItem, TPutItem, TListSchema, TPutSchema>) {
  const {resource} = config;
  const queryKeys = {
    all: [resource] as const,
    list: (workspaceId: string, scope: StoreScope = workspaceStoreScope) =>
      [...queryKeys.all, 'list', workspaceId, scope] as const,
  };

  function searchForScope(scope: StoreScope, includeLimit = false): string {
    const search = new URLSearchParams();
    if (includeLimit) search.set('limit', String(SECRETS_MAX_LIST_LIMIT));
    const projectId = projectIdFromScope(scope);
    if (projectId) search.set('project_id', projectId);
    return search.toString();
  }

  async function listAll(params: {
    workspaceId: string;
    scope?: StoreScope;
    signal?: AbortSignal | undefined;
  }): Promise<TListItem[]> {
    const scope = params.scope ?? workspaceStoreScope;
    const response = await checkedApiRequest(
      config.listResponseSchema,
      `/workspaces/${params.workspaceId}/${resource}?${searchForScope(scope, true)}`,
      {signal: params.signal},
    );
    return config.toListItems(response);
  }

  async function put(command: PutStoreCommand) {
    const response = await checkedApiRequest(
      config.putResponseSchema,
      `/workspaces/${command.workspaceId}/${resource}/${encodeURIComponent(command.key)}`,
      {
        method: 'PUT',
        body: {value: command.value, project_id: projectIdFromScope(command.scope)},
      },
    );
    return config.toPutResult(response);
  }

  async function remove(command: DeleteStoreCommand): Promise<void> {
    const search = searchForScope(command.scope);
    await apiRequest<void>(
      `/workspaces/${command.workspaceId}/${resource}/${encodeURIComponent(command.key)}${search ? `?${search}` : ''}`,
      {method: 'DELETE'},
    );
  }

  function listQueryOptions(workspaceId: string, scope: StoreScope = workspaceStoreScope) {
    return queryOptions({
      queryKey: queryKeys.list(workspaceId, scope),
      queryFn: ({signal}) => listAll({workspaceId, scope, signal}),
    });
  }

  function useListQuery(workspaceId: string | undefined, scope: StoreScope = workspaceStoreScope) {
    return useQuery({...listQueryOptions(workspaceId ?? '', scope), enabled: Boolean(workspaceId)});
  }

  function usePutMutation() {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: put,
      onSuccess: async () => await queryClient.invalidateQueries({queryKey: queryKeys.all}),
    });
  }

  function useDeleteMutation() {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: remove,
      onSuccess: async () => await queryClient.invalidateQueries({queryKey: queryKeys.all}),
    });
  }

  return {
    queryKeys,
    listAll,
    put,
    remove,
    listQueryOptions,
    useListQuery,
    usePutMutation,
    useDeleteMutation,
  };
}
