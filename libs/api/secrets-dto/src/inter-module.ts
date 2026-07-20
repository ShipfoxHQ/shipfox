import {defineInterModuleContract, type InterModuleClient} from '@shipfox/inter-module';
import {z} from 'zod';

const idSchema = z.string().uuid();
const scopeSchema = z.object({
  workspaceId: idSchema,
  projectId: idSchema.nullish(),
  namespace: z.string().default(''),
});

const decryptionErrors = {
  'secret-decryption-failed': z.object({}),
};

/** Producer-owned Secrets operations used by Agent, Integrations, and Workflows. */
export const secretsInterModuleContract = defineInterModuleContract({
  module: 'secrets',
  methods: {
    getSecret: {
      input: scopeSchema.extend({key: z.string(), store: z.string().optional()}),
      output: z.object({value: z.string().nullable()}),
      errors: decryptionErrors,
    },
    getSecretsByNamespace: {
      input: scopeSchema.extend({store: z.string().optional()}),
      output: z.object({values: z.record(z.string(), z.string())}),
      errors: decryptionErrors,
    },
    getVariablesByNamespace: {
      input: scopeSchema,
      output: z.object({values: z.record(z.string(), z.string())}),
    },
    setSecrets: {
      input: scopeSchema.extend({
        values: z.record(z.string(), z.string()),
        editedBy: idSchema.nullish(),
      }),
      output: z.object({}),
      errors: {
        'value-too-large': z.object({maxBytes: z.number().int().positive()}),
        'workspace-secret-cap-exceeded': z.object({cap: z.number().int().positive()}),
      },
    },
    deleteSecrets: {
      input: scopeSchema.extend({keys: z.array(z.string()).optional()}),
      output: z.object({deleted: z.number().int().nonnegative()}),
    },
  },
});

export type SecretsInterModuleClient = InterModuleClient<typeof secretsInterModuleContract>;
