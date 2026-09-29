import {defineInterModuleContract, type InterModuleClient} from '@shipfox/inter-module';
import {z} from 'zod';
import {
  registryCatalogResponseSchema,
  registryPackageIndexResponseSchema,
  registryPackageRequestSchema,
  registryReadmeSchema,
  registrySourceSchema,
  registryVersionRefSchema,
  resolvedRegistryVersionSchema,
  resolveRegistryVersionRequestSchema,
} from './schemas/version.js';

// Only `registry-unavailable` is retryable.
const versionErrors = {
  'registry-disabled': z.object({}),
  'registry-version-not-found': registryVersionRefSchema,
  'registry-unavailable': z.object({}),
  'registry-signature-invalid': registryVersionRefSchema,
  'registry-schema-unsupported': registryVersionRefSchema,
};

// The indexes are unsigned, so they cannot fail verification, and a missing package is a value.
const indexErrors = {
  'registry-disabled': z.object({}),
  'registry-unavailable': z.object({}),
};

export const registryInterModuleContract = defineInterModuleContract({
  module: 'registry',
  methods: {
    resolveVersion: {
      input: resolveRegistryVersionRequestSchema,
      output: resolvedRegistryVersionSchema,
      errors: versionErrors,
    },
    getSource: {
      input: registryVersionRefSchema,
      output: registrySourceSchema,
      errors: versionErrors,
    },
    getReadme: {
      input: registryVersionRefSchema,
      output: registryReadmeSchema,
      errors: versionErrors,
    },
    getPackageIndex: {
      input: registryPackageRequestSchema,
      output: registryPackageIndexResponseSchema,
      errors: indexErrors,
    },
    getCatalog: {
      input: z.object({}),
      output: registryCatalogResponseSchema,
      errors: indexErrors,
    },
  },
});

export type RegistryInterModuleClient = InterModuleClient<typeof registryInterModuleContract>;
