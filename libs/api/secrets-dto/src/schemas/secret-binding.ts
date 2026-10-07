import {z} from 'zod';
import {secretKeySchema} from './identifiers.js';

export const secretStoreSchema = z.enum(['local', 'inputs']);
export const SECRET_BINDING_TARGET_PATTERN_SOURCE = '^[A-Za-z_][A-Za-z0-9_]*$';
export const SECRET_BINDING_TARGET_PATTERN = new RegExp(SECRET_BINDING_TARGET_PATTERN_SOURCE);

export const secretBindingTargetSchema = z.string().min(1).regex(SECRET_BINDING_TARGET_PATTERN);

// A bare string target names an environment variable, so run-step bindings keep their shape.
export const secretBindingInputTargetSchema = z.object({
  kind: z.literal('input'),
  name: secretBindingTargetSchema,
});

// Job container bindings belong to the setup step. A credential target is the registry username
// or password, and an env target is a variable of the container.
export const secretBindingContainerCredentialTargetSchema = z.object({
  kind: z.literal('container_credential'),
  field: z.enum(['username', 'password']),
});

export const secretBindingContainerEnvTargetSchema = z.object({
  kind: z.literal('container_env'),
  name: secretBindingTargetSchema,
});

export const secretBindingSegmentSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('literal'),
    value: z.string(),
  }),
  z.object({
    kind: z.literal('secret'),
    store: secretStoreSchema,
    key: secretKeySchema,
  }),
]);

export const materializedSecretBindingSchema = z.object({
  target: z.union([
    secretBindingTargetSchema,
    secretBindingInputTargetSchema,
    secretBindingContainerCredentialTargetSchema,
    secretBindingContainerEnvTargetSchema,
  ]),
  segments: z.array(secretBindingSegmentSchema),
});

export type SecretBindingSegmentDto = z.infer<typeof secretBindingSegmentSchema>;
export type SecretBindingInputTargetDto = z.infer<typeof secretBindingInputTargetSchema>;
export type SecretBindingContainerCredentialTargetDto = z.infer<
  typeof secretBindingContainerCredentialTargetSchema
>;
export type SecretBindingContainerEnvTargetDto = z.infer<
  typeof secretBindingContainerEnvTargetSchema
>;
export type MaterializedSecretBindingDto = z.infer<typeof materializedSecretBindingSchema>;
