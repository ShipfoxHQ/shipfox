import {z} from 'zod';
import {secretKeySchema} from './identifiers.js';

export const secretStoreSchema = z.literal('local');
export const SECRET_BINDING_TARGET_PATTERN_SOURCE = '^[A-Za-z_][A-Za-z0-9_]*$';
export const SECRET_BINDING_TARGET_PATTERN = new RegExp(SECRET_BINDING_TARGET_PATTERN_SOURCE);

export const secretBindingTargetSchema = z.string().min(1).regex(SECRET_BINDING_TARGET_PATTERN);

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
  target: secretBindingTargetSchema,
  segments: z.array(secretBindingSegmentSchema),
});

export type SecretBindingSegmentDto = z.infer<typeof secretBindingSegmentSchema>;
export type MaterializedSecretBindingDto = z.infer<typeof materializedSecretBindingSchema>;
