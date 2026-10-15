import {
  secretBindingAnyTargetSchema,
  secretBindingLiteralSegmentSchema,
  secretBindingSecretSegmentSchema,
} from '@shipfox/api-secrets-dto';
import {z} from 'zod';

/** Patterns one `hashFiles()` call may name, one CEL overload per count. */
export const HASH_FILES_BINDING_MAX_PATTERNS = 16;

// The runner hashes the files that match `patterns` in the step working directory when the step
// starts. The value is not a secret.
export const hashFilesBindingSegmentSchema = z.object({
  kind: z.literal('hash_files'),
  patterns: z.array(z.string().min(1)).min(1).max(HASH_FILES_BINDING_MAX_PATTERNS),
});

export const stepBindingSegmentSchema = z.discriminatedUnion('kind', [
  secretBindingLiteralSegmentSchema,
  secretBindingSecretSegmentSchema,
  hashFilesBindingSegmentSchema,
]);

/**
 * A step config value the runner assembles when the step starts, from literal text, secrets, and
 * file hashes. Stored under `secret_bindings` in the step config.
 */
export const stepBindingSchema = z.object({
  target: secretBindingAnyTargetSchema,
  segments: z.array(stepBindingSegmentSchema),
});

export type HashFilesBindingSegmentDto = z.infer<typeof hashFilesBindingSegmentSchema>;
export type StepBindingSegmentDto = z.infer<typeof stepBindingSegmentSchema>;
export type StepBindingDto = z.infer<typeof stepBindingSchema>;
