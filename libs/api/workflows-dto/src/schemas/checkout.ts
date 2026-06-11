import {z} from 'zod';

export const checkoutIntentSchema = z.object({
  repository_url: z.string().min(1),
  ref: z.string().min(1),
  provider: z.string().min(1),
  source_connection_id: z.string().uuid(),
  external_repository_id: z.string().min(1),
});

export type CheckoutIntentDto = z.infer<typeof checkoutIntentSchema>;
