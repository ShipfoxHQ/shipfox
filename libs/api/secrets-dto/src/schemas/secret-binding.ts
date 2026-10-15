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

// An env variable of one MCP server that an agent step starts. Only that server's process gets it.
export const secretBindingMcpServerEnvTargetSchema = z.object({
  kind: z.literal('mcp_server_env'),
  server: z.string().min(1),
  name: secretBindingTargetSchema,
});

export const secretBindingLiteralSegmentSchema = z.object({
  kind: z.literal('literal'),
  value: z.string(),
});

export const secretBindingSecretSegmentSchema = z.object({
  kind: z.literal('secret'),
  store: secretStoreSchema,
  key: secretKeySchema,
});

export const secretBindingSegmentSchema = z.discriminatedUnion('kind', [
  secretBindingLiteralSegmentSchema,
  secretBindingSecretSegmentSchema,
]);

export const secretBindingAnyTargetSchema = z.union([
  secretBindingTargetSchema,
  secretBindingInputTargetSchema,
  secretBindingContainerCredentialTargetSchema,
  secretBindingContainerEnvTargetSchema,
  secretBindingMcpServerEnvTargetSchema,
]);

export const materializedSecretBindingSchema = z.object({
  target: secretBindingAnyTargetSchema,
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
export type SecretBindingMcpServerEnvTargetDto = z.infer<
  typeof secretBindingMcpServerEnvTargetSchema
>;
export type SecretBindingTargetDto = z.infer<typeof secretBindingAnyTargetSchema>;
export type MaterializedSecretBindingDto = z.infer<typeof materializedSecretBindingSchema>;
