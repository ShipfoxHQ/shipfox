import {z} from 'zod';

/** Intents a composing application may handle in place of opening `url`. */
export const REQUIRED_ACTION_INTENTS = {
  /** Put the user in touch with the operator's support team. */
  contactSupport: 'contact-support',
} as const;

export const requiredActionSchema = z.object({
  reason: z.string(),
  message: z.string(),
  /** Fallback target. Surfaces that don't handle `intent` open it. */
  url: z.string(),
  /** Free string, so a stored retired or future value still parses. An unknown value renders as `url`. */
  intent: z.string().optional(),
});

export type RequiredAction = z.infer<typeof requiredActionSchema>;

export const policyNoticeSchema = z.object({
  reason: z.string(),
  message: z.string(),
  requiredAction: requiredActionSchema.optional(),
});

export type PolicyNotice = z.infer<typeof policyNoticeSchema>;
