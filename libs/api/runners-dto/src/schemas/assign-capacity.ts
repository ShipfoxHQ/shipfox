import {z} from 'zod';

export const assignCapacityBatchBodySchema = z
  .object({
    reservation_id: z.string().uuid(),
    capacity_ids: z.array(z.string().uuid()).min(1).max(1000),
  })
  .refine((body) => new Set(body.capacity_ids).size === body.capacity_ids.length, {
    message: 'capacity_ids values must be unique',
    path: ['capacity_ids'],
  });

export const assignedCapacitySchema = z.object({
  capacity_id: z.string().uuid(),
  assignment_id: z.string().uuid(),
});
export const assignCapacityBatchResponseSchema = z.object({
  assignments: z.array(assignedCapacitySchema),
});

export type AssignCapacityBatchBodyDto = z.infer<typeof assignCapacityBatchBodySchema>;
export type AssignCapacityBatchResponseDto = z.infer<typeof assignCapacityBatchResponseSchema>;
