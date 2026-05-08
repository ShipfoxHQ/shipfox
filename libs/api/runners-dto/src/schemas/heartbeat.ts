import {z} from 'zod';

export const heartbeatResponseSchema = z.object({
  cancel: z.boolean(),
});

export type HeartbeatResponseDto = z.infer<typeof heartbeatResponseSchema>;
