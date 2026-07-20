import {secretsInterModuleContract} from '@shipfox/api-secrets-dto/inter-module';
import {
  createInterModuleKnownError,
  defineInterModulePresentation,
  type InterModulePresentation,
} from '@shipfox/inter-module';
import {
  deleteSecrets,
  getSecret,
  getSecretsByNamespace,
  getVariablesByNamespace,
  SecretDecryptionError,
  SecretValueTooLargeError,
  setSecrets,
  WorkspaceSecretCapExceededError,
} from '#core/index.js';

export function createSecretsInterModulePresentation(): InterModulePresentation<
  typeof secretsInterModuleContract
> {
  return defineInterModulePresentation(secretsInterModuleContract, {
    getSecret: async (input) => {
      try {
        const {store, ...params} = input;
        return {value: await getSecret({...params, ...(store === undefined ? {} : {store})})};
      } catch (error) {
        throw toGetKnownError('getSecret', error);
      }
    },
    getSecretsByNamespace: async (input) => {
      try {
        const {store, ...params} = input;
        return {
          values: await getSecretsByNamespace({...params, ...(store === undefined ? {} : {store})}),
        };
      } catch (error) {
        throw toGetKnownError('getSecretsByNamespace', error);
      }
    },
    getVariablesByNamespace: async (input) => ({
      values: await getVariablesByNamespace(input),
    }),
    setSecrets: async (input) => {
      try {
        await setSecrets(input);
        return {};
      } catch (error) {
        throw toSetKnownError(error);
      }
    },
    deleteSecrets: async (input) => ({deleted: await deleteSecrets(input)}),
  });
}

function toGetKnownError(
  methodName: 'getSecret' | 'getSecretsByNamespace',
  error: unknown,
): unknown {
  if (error instanceof SecretDecryptionError) {
    return createInterModuleKnownError(
      secretsInterModuleContract.methods[methodName],
      'secret-decryption-failed',
      {},
    );
  }
  return error;
}

function toSetKnownError(error: unknown): unknown {
  const method = secretsInterModuleContract.methods.setSecrets;
  if (error instanceof SecretValueTooLargeError) {
    return createInterModuleKnownError(method, 'value-too-large', {maxBytes: error.maxBytes});
  }
  if (error instanceof WorkspaceSecretCapExceededError) {
    return createInterModuleKnownError(method, 'workspace-secret-cap-exceeded', {cap: error.cap});
  }
  return error;
}
