import type {
  ListSecretsResponseDto,
  PutSecretBodyDto,
  PutSecretResponseDto,
  SecretDto,
} from '@shipfox/api-secrets-dto';
import {createStoreApi} from './create-store-api.js';

const secretsApi = createStoreApi<
  SecretDto,
  ListSecretsResponseDto,
  PutSecretBodyDto,
  PutSecretResponseDto
>({
  resource: 'secrets',
  listItems: (response) => response.secrets,
  putItem: (response) => response.secret,
});

export const secretsQueryKeys = secretsApi.queryKeys;
export const listSecrets = secretsApi.listAll;
export const putSecret = secretsApi.put;
export const deleteSecret = secretsApi.remove;
export const useSecretsQuery = secretsApi.useListQuery;
export const usePutSecretMutation = secretsApi.usePutMutation;
export const useDeleteSecretMutation = secretsApi.useDeleteMutation;
