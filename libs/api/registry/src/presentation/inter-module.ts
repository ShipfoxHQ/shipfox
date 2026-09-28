import {Buffer} from 'node:buffer';
import {registryInterModuleContract} from '@shipfox/api-registry-dto/inter-module';
import {
  createInterModuleKnownError,
  defineInterModulePresentation,
  type InterModulePresentation,
} from '@shipfox/inter-module';
import {
  RegistryDisabledError,
  RegistrySchemaUnsupportedError,
  RegistrySignatureInvalidError,
  RegistryUnavailableError,
  RegistryVersionNotFoundError,
} from '#core/errors.js';
import {getReadme, getSource, resolveVersion} from '#core/resolve-version.js';
import type {RegistrySettings} from '#core/settings.js';

export function createRegistryInterModulePresentation(params: {
  settings: RegistrySettings;
}): InterModulePresentation<typeof registryInterModuleContract> {
  const {settings} = params;
  return defineInterModulePresentation(registryInterModuleContract, {
    resolveVersion: async (input) => {
      try {
        const version = await resolveVersion({settings, ...input});
        return {
          digest: version.digest,
          document: version.document,
          content: Buffer.from(version.content).toString('base64'),
        };
      } catch (error) {
        throw toKnownError('resolveVersion', error);
      }
    },
    getSource: async (input) => {
      try {
        const source = await getSource({settings, ...input});
        return {source: Buffer.from(source).toString('base64')};
      } catch (error) {
        throw toKnownError('getSource', error);
      }
    },
    getReadme: async (input) => {
      try {
        return {readme: (await getReadme({settings, ...input})) ?? null};
      } catch (error) {
        throw toKnownError('getReadme', error);
      }
    },
  });
}

function toKnownError(
  methodName: keyof typeof registryInterModuleContract.methods,
  error: unknown,
): unknown {
  const method = registryInterModuleContract.methods[methodName];
  if (error instanceof RegistryDisabledError) {
    return createInterModuleKnownError(method, 'registry-disabled', {});
  }
  if (error instanceof RegistryVersionNotFoundError) {
    return createInterModuleKnownError(method, 'registry-version-not-found', {
      package: error.package,
      version: error.version,
    });
  }
  if (error instanceof RegistryUnavailableError) {
    return createInterModuleKnownError(method, 'registry-unavailable', {});
  }
  if (error instanceof RegistrySignatureInvalidError) {
    return createInterModuleKnownError(method, 'registry-signature-invalid', {
      package: error.package,
      version: error.version,
    });
  }
  if (error instanceof RegistrySchemaUnsupportedError) {
    return createInterModuleKnownError(method, 'registry-schema-unsupported', {
      package: error.package,
      version: error.version,
    });
  }
  return error;
}
