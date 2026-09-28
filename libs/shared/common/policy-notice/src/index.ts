import {z} from 'zod';

export const requiredActionSchema = z.object({
  reason: z.string(),
  message: z.string(),
  url: z.string(),
});

export type RequiredAction = z.infer<typeof requiredActionSchema>;

export const policyNoticeSchema = z.object({
  reason: z.string(),
  message: z.string(),
  requiredAction: requiredActionSchema.optional(),
});

export type PolicyNotice = z.infer<typeof policyNoticeSchema>;
