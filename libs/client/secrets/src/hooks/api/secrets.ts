import {listSecretsResponseSchema, putSecretResponseSchema} from '@shipfox/api-secrets-dto';
import {createStoreApi} from './create-store-api.js';
import {toSecretMetadata, toStoreWriteWarnings} from './store-mapper.js';

const secretsApi = createStoreApi({
  resource: 'secrets',
  listResponseSchema: listSecretsResponseSchema,
  putResponseSchema: putSecretResponseSchema,
  toListItems: (response) => response.secrets.map(toSecretMetadata),
  toPutResult: (response) => ({
    item: toSecretMetadata(response.secret),
    warnings: toStoreWriteWarnings(response.warnings),
  }),
});

export const secretsQueryKeys = secretsApi.queryKeys;
export const listSecrets = secretsApi.listAll;
export const putSecret = secretsApi.put;
export const deleteSecret = secretsApi.remove;
export const listSecretsQueryOptions = secretsApi.listQueryOptions;
export const useSecretsQuery = secretsApi.useListQuery;
export const usePutSecretMutation = secretsApi.usePutMutation;
export const useDeleteSecretMutation = secretsApi.useDeleteMutation;
