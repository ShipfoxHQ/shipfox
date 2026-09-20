import {z} from 'zod';

const emailLinkSchema = z.string().url();

export const AUTH_PASSWORD_RESET_SEND_REQUESTED = 'auth.password_reset.send_requested' as const;
export const AUTH_USER_SIGNED_IN = 'auth.user.signed_in' as const;
export const AUTH_USER_SIGNED_UP = 'auth.user.signed_up' as const;

export const authPasswordResetSendRequestedSchema = z.object({
  email: z.string().email(),
  resetLink: emailLinkSchema,
  expiresInHours: z.number().int().positive(),
});
export type AuthPasswordResetSendRequestedEvent = z.infer<
  typeof authPasswordResetSendRequestedSchema
>;

export const authUserSignedUpSchema = z.object({
  userId: z.string(),
  email: z.string().email(),
  name: z.string().optional(),
  viaInvitation: z.boolean(),
});
export type AuthUserSignedUpEvent = z.infer<typeof authUserSignedUpSchema>;

export const authUserSignedInSchema = z
  .object({
    userId: z.string().uuid(),
  })
  .strict();
export type AuthUserSignedInEvent = z.infer<typeof authUserSignedInSchema>;

export interface AuthEventMap {
  [AUTH_PASSWORD_RESET_SEND_REQUESTED]: AuthPasswordResetSendRequestedEvent;
  [AUTH_USER_SIGNED_IN]: AuthUserSignedInEvent;
  [AUTH_USER_SIGNED_UP]: AuthUserSignedUpEvent;
}

export const authEventSchemas = {
  [AUTH_PASSWORD_RESET_SEND_REQUESTED]: authPasswordResetSendRequestedSchema,
  [AUTH_USER_SIGNED_IN]: authUserSignedInSchema,
  [AUTH_USER_SIGNED_UP]: authUserSignedUpSchema,
} satisfies Record<keyof AuthEventMap, z.ZodType>;
