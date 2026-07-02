import {SECRETS_MAX_LIST_LIMIT, type SecretWriteWarningDto} from '@shipfox/api-secrets-dto';
import {apiRequest} from '@shipfox/client-api';
import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';

/**
 * Secrets and variables share an identical management surface (list / put /
 * delete under `/workspaces/:id/{resource}`); only the response envelope keys
 * and DTO types differ. This factory builds the typed transport functions,
 * query keys, and React Query hooks for one resource so `secrets.ts` and
 * `variables.ts` stay thin instantiations. The forms and sections diverge
 * (write-only vs readable) and are kept separate on purpose.
 */
export interface CreateStoreApiConfig<TItem, TListResponse, TPutResponse> {
  /** URL segment and query-key namespace, e.g. `'secrets'` or `'variables'`. */
  resource: string;
  /** Pulls the item array out of a list response. */
  listItems: (response: TListResponse) => TItem[];
  /** Pulls the single item out of a put response. */
  putItem: (response: TPutResponse) => TItem;
}

export interface PutResult<TItem> {
  item: TItem;
  warnings: SecretWriteWarningDto[];
}

export function createStoreApi<
  TItem,
  TListResponse,
  TPutBody,
  TPutResponse extends {warnings: SecretWriteWarningDto[]},
>(config: CreateStoreApiConfig<TItem, TListResponse, TPutResponse>) {
  const {resource, listItems, putItem} = config;

  const queryKeys = {
    all: [resource] as const,
    list: (workspaceId: string) => [resource, 'list', workspaceId] as const,
  };

  // The store is a bounded set (per-workspace cap), so the UI fetches every key
  // in one call rather than paginating: request the max limit and ignore the
  // cursor. See SECRETS_MAX_LIST_LIMIT / the S1a list route.
  async function listAll(params: {
    workspaceId: string;
    projectId?: string | undefined;
    signal?: AbortSignal | undefined;
  }): Promise<TItem[]> {
    const search = new URLSearchParams({limit: String(SECRETS_MAX_LIST_LIMIT)});
    if (params.projectId) search.set('project_id', params.projectId);
    const response = await apiRequest<TListResponse>(
      `/workspaces/${params.workspaceId}/${resource}?${search.toString()}`,
      {signal: params.signal},
    );
    return listItems(response);
  }

  async function put(params: {
    workspaceId: string;
    key: string;
    body: TPutBody;
  }): Promise<PutResult<TItem>> {
    const response = await apiRequest<TPutResponse>(
      `/workspaces/${params.workspaceId}/${resource}/${encodeURIComponent(params.key)}`,
      {method: 'PUT', body: params.body},
    );
    return {item: putItem(response), warnings: response.warnings};
  }

  async function remove(params: {
    workspaceId: string;
    key: string;
    projectId?: string | undefined;
  }): Promise<void> {
    const search = params.projectId
      ? `?${new URLSearchParams({project_id: params.projectId}).toString()}`
      : '';
    await apiRequest<void>(
      `/workspaces/${params.workspaceId}/${resource}/${encodeURIComponent(params.key)}${search}`,
      {method: 'DELETE'},
    );
  }

  function useListQuery(workspaceId: string | undefined) {
    return useQuery({
      queryKey: workspaceId ? queryKeys.list(workspaceId) : [resource, 'list'],
      enabled: Boolean(workspaceId),
      queryFn: ({signal}) => listAll({workspaceId: workspaceId ?? '', signal}),
    });
  }

  function usePutMutation() {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: put,
      // Invalidate the whole resource namespace so the per-item detail cache
      // (full variable values) is refreshed too, not just the list.
      onSuccess: async () => {
        await queryClient.invalidateQueries({queryKey: queryKeys.all});
      },
    });
  }

  function useDeleteMutation() {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: remove,
      onSuccess: async () => {
        await queryClient.invalidateQueries({queryKey: queryKeys.all});
      },
    });
  }

  return {queryKeys, listAll, put, remove, useListQuery, usePutMutation, useDeleteMutation};
}
