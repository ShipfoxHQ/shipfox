import {z} from 'zod';
import {secretKeySchema} from './identifiers.js';

export const secretStoreSchema = z.literal('local');

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
  target: z.string().min(1),
  segments: z.array(secretBindingSegmentSchema),
});

export type SecretBindingSegmentDto = z.infer<typeof secretBindingSegmentSchema>;
export type MaterializedSecretBindingDto = z.infer<typeof materializedSecretBindingSchema>;
