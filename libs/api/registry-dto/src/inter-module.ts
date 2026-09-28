import {defineInterModuleContract, type InterModuleClient} from '@shipfox/inter-module';
import {z} from 'zod';
import {
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
  },
});

export type RegistryInterModuleClient = InterModuleClient<typeof registryInterModuleContract>;
