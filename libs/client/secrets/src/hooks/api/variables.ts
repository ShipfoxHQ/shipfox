import {
  getVariableResponseSchema,
  listVariablesResponseSchema,
  putVariableResponseSchema,
} from '@shipfox/api-secrets-dto';
import {checkedApiRequest} from '@shipfox/client-api';
import {type FetchQueryOptions, queryOptions, useQuery} from '@tanstack/react-query';
import {
  projectIdFromScope,
  type StoreScope,
  type Variable,
  workspaceStoreScope,
} from '#core/store.js';
import {createStoreApi} from './create-store-api.js';
import {toStoreWriteWarnings, toVariable, toVariablePreview} from './store-mapper.js';

const variablesApi = createStoreApi({
  resource: 'variables',
  listResponseSchema: listVariablesResponseSchema,
  putResponseSchema: putVariableResponseSchema,
  toListItems: (response) => response.variables.map(toVariablePreview),
  toPutResult: (response) => ({
    item: toVariable(response.variable),
    warnings: toStoreWriteWarnings(response.warnings),
  }),
});

export const variablesQueryKeys = variablesApi.queryKeys;
export const listVariables = variablesApi.listAll;
export const putVariable = variablesApi.put;
export const deleteVariable = variablesApi.remove;
export const listVariablesQueryOptions = variablesApi.listQueryOptions;
export const useVariablesQuery = variablesApi.useListQuery;
export const usePutVariableMutation = variablesApi.usePutMutation;
export const useDeleteVariableMutation = variablesApi.useDeleteMutation;

export const variableQueryKey = (workspaceId: string, key: string, scope: StoreScope) =>
  [...variablesQueryKeys.all, 'detail', workspaceId, key, scope] as const;

type VariableQueryOptions = FetchQueryOptions<
  Variable,
  Error,
  Variable,
  ReturnType<typeof variableQueryKey>
>;

export async function getVariable(params: {
  workspaceId: string;
  key: string;
  scope?: StoreScope;
  signal?: AbortSignal | undefined;
}) {
  const scope = params.scope ?? workspaceStoreScope;
  const projectId = projectIdFromScope(scope);
  const search = projectId ? `?${new URLSearchParams({project_id: projectId}).toString()}` : '';
  const response = await checkedApiRequest(
    getVariableResponseSchema,
    `/workspaces/${params.workspaceId}/variables/${encodeURIComponent(params.key)}${search}`,
    {signal: params.signal},
  );
  return toVariable(response.variable);
}

export function variableQueryOptions(
  workspaceId: string,
  key: string,
  scope: StoreScope = workspaceStoreScope,
): VariableQueryOptions {
  return queryOptions({
    queryKey: variableQueryKey(workspaceId, key, scope),
    queryFn: ({signal}) => getVariable({workspaceId, key, scope, signal}),
  });
}

export function useVariableQuery(workspaceId: string, key: string | undefined) {
  return useQuery({...variableQueryOptions(workspaceId, key ?? ''), enabled: Boolean(key)});
}
