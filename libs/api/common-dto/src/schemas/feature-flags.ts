import {z} from 'zod';

export const featureFlagsQuerySchema = z.object({
  /** Evaluates the flags for this workspace too. The caller must be a member. */
  workspace_id: z.uuid().optional(),
});

export type FeatureFlagsQueryDto = z.infer<typeof featureFlagsQuerySchema>;

/** Every flag declared with `client: true`, keyed by flag key. Server-only flags never appear. */
export const featureFlagsResponseSchema = z.object({
  flags: z.record(z.string(), z.unknown()),
});

export type FeatureFlagsResponseDto = z.infer<typeof featureFlagsResponseSchema>;
