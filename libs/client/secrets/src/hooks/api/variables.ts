import type {
  ListVariablesResponseDto,
  PutVariableBodyDto,
  PutVariableResponseDto,
  VariableDto,
} from '@shipfox/api-secrets-dto';
import {createStoreApi} from './create-store-api.js';

const variablesApi = createStoreApi<
  VariableDto,
  ListVariablesResponseDto,
  PutVariableBodyDto,
  PutVariableResponseDto
>({
  resource: 'variables',
  listItems: (response) => response.variables,
  putItem: (response) => response.variable,
});

export const variablesQueryKeys = variablesApi.queryKeys;
export const listVariables = variablesApi.listAll;
export const putVariable = variablesApi.put;
export const deleteVariable = variablesApi.remove;
export const useVariablesQuery = variablesApi.useListQuery;
export const usePutVariableMutation = variablesApi.usePutMutation;
export const useDeleteVariableMutation = variablesApi.useDeleteMutation;
