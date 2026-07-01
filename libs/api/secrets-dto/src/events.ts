import {z} from 'zod';
import {secretKeySchema} from './schemas/identifiers.js';

const eventPayloadSchema = z.object({
  actorId: z.string().uuid(),
  workspaceId: z.string().uuid(),
  projectId: z.string().uuid().nullable(),
  key: secretKeySchema,
});

export const SECRET_CREATED = 'secrets.secret.created' as const;
export const SECRET_UPDATED = 'secrets.secret.updated' as const;
export const SECRET_DELETED = 'secrets.secret.deleted' as const;
export const VARIABLE_CREATED = 'secrets.variable.created' as const;
export const VARIABLE_UPDATED = 'secrets.variable.updated' as const;
export const VARIABLE_DELETED = 'secrets.variable.deleted' as const;

export const secretCreatedEventSchema = eventPayloadSchema;
export const secretUpdatedEventSchema = eventPayloadSchema;
export const secretDeletedEventSchema = eventPayloadSchema;
export const variableCreatedEventSchema = eventPayloadSchema;
export const variableUpdatedEventSchema = eventPayloadSchema;
export const variableDeletedEventSchema = eventPayloadSchema;

export type SecretCreatedEvent = z.infer<typeof secretCreatedEventSchema>;
export type SecretUpdatedEvent = z.infer<typeof secretUpdatedEventSchema>;
export type SecretDeletedEvent = z.infer<typeof secretDeletedEventSchema>;
export type VariableCreatedEvent = z.infer<typeof variableCreatedEventSchema>;
export type VariableUpdatedEvent = z.infer<typeof variableUpdatedEventSchema>;
export type VariableDeletedEvent = z.infer<typeof variableDeletedEventSchema>;

export interface SecretsEventMap {
  [SECRET_CREATED]: SecretCreatedEvent;
  [SECRET_UPDATED]: SecretUpdatedEvent;
  [SECRET_DELETED]: SecretDeletedEvent;
  [VARIABLE_CREATED]: VariableCreatedEvent;
  [VARIABLE_UPDATED]: VariableUpdatedEvent;
  [VARIABLE_DELETED]: VariableDeletedEvent;
}

export const secretsEventSchemas = {
  [SECRET_CREATED]: secretCreatedEventSchema,
  [SECRET_UPDATED]: secretUpdatedEventSchema,
  [SECRET_DELETED]: secretDeletedEventSchema,
  [VARIABLE_CREATED]: variableCreatedEventSchema,
  [VARIABLE_UPDATED]: variableUpdatedEventSchema,
  [VARIABLE_DELETED]: variableDeletedEventSchema,
} satisfies Record<keyof SecretsEventMap, z.ZodType>;
