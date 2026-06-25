import {z} from 'zod';

const emailLinkSchema = z.string().url();

export const AUTH_EMAIL_VERIFICATION_SEND_REQUESTED =
  'auth.email_verification.send_requested' as const;
export const AUTH_PASSWORD_RESET_SEND_REQUESTED = 'auth.password_reset.send_requested' as const;

export const authEmailVerificationSendRequestedSchema = z.object({
  email: z.string().email(),
  verifyLink: emailLinkSchema,
});
export type AuthEmailVerificationSendRequestedEvent = z.infer<
  typeof authEmailVerificationSendRequestedSchema
>;

export const authPasswordResetSendRequestedSchema = z.object({
  email: z.string().email(),
  resetLink: emailLinkSchema,
  expiresInHours: z.number().int().positive(),
});
export type AuthPasswordResetSendRequestedEvent = z.infer<
  typeof authPasswordResetSendRequestedSchema
>;

export interface AuthEventMap {
  [AUTH_EMAIL_VERIFICATION_SEND_REQUESTED]: AuthEmailVerificationSendRequestedEvent;
  [AUTH_PASSWORD_RESET_SEND_REQUESTED]: AuthPasswordResetSendRequestedEvent;
}

export const authEventSchemas = {
  [AUTH_EMAIL_VERIFICATION_SEND_REQUESTED]: authEmailVerificationSendRequestedSchema,
  [AUTH_PASSWORD_RESET_SEND_REQUESTED]: authPasswordResetSendRequestedSchema,
} satisfies Record<keyof AuthEventMap, z.ZodType>;
