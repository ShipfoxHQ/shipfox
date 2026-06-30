import {z} from 'zod';

export const heartbeatResponseSchema = z.object({
  cancel: z.boolean(),
  lease_token: z.string().min(1),
});

export type HeartbeatResponseDto = z.infer<typeof heartbeatResponseSchema>;
