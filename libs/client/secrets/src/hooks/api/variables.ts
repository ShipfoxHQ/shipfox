import type {
  GetVariableResponseDto,
  ListVariablesResponseDto,
  PutVariableBodyDto,
  PutVariableResponseDto,
  VariableDto,
  VariableListItemDto,
} from '@shipfox/api-secrets-dto';
import {apiRequest} from '@shipfox/client-api';
import {useQuery} from '@tanstack/react-query';
import {createStoreApi} from './create-store-api.js';

const variablesApi = createStoreApi<
  VariableListItemDto,
  ListVariablesResponseDto,
  PutVariableBodyDto,
  PutVariableResponseDto
>({
  resource: 'variables',
  listItems: (response) => response.variables,
  // The list carries only a preview; a freshly-written value is the full value.
  putItem: (response) => ({...response.variable, value_truncated: false}),
});

export const variablesQueryKeys = variablesApi.queryKeys;
export const listVariables = variablesApi.listAll;
export const putVariable = variablesApi.put;
export const deleteVariable = variablesApi.remove;
export const useVariablesQuery = variablesApi.useListQuery;
export const usePutVariableMutation = variablesApi.usePutMutation;
export const useDeleteVariableMutation = variablesApi.useDeleteMutation;

/**
 * Reads a single variable including its full value. The list only returns a
 * bounded preview, so editing a truncated variable fetches the full value here.
 */
export async function getVariable(params: {
  workspaceId: string;
  key: string;
  projectId?: string | undefined;
  signal?: AbortSignal | undefined;
}): Promise<VariableDto> {
  const search = params.projectId
    ? `?${new URLSearchParams({project_id: params.projectId}).toString()}`
    : '';
  const response = await apiRequest<GetVariableResponseDto>(
    `/workspaces/${params.workspaceId}/variables/${encodeURIComponent(params.key)}${search}`,
    {signal: params.signal},
  );
  return response.variable;
}

export function useVariableQuery(workspaceId: string, key: string | undefined) {
  return useQuery({
    queryKey: key
      ? [...variablesQueryKeys.all, 'detail', workspaceId, key]
      : [...variablesQueryKeys.all, 'detail'],
    enabled: Boolean(key),
    queryFn: ({signal}) => getVariable({workspaceId, key: key ?? '', signal}),
  });
}
