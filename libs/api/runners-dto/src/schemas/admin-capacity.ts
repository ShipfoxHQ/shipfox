import {z} from 'zod';

export const adminRunnerCapacityResponseSchema = z.object({
  workspace_id: z.string().uuid(),
  units_in_use: z.number().int().nonnegative(),
  queued_for_capacity: z.number().int().nonnegative(),
});

export type AdminRunnerCapacityResponseDto = z.infer<typeof adminRunnerCapacityResponseSchema>;
