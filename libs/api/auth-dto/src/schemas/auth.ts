import {z} from 'zod';
import {userDtoSchema} from './user.js';

export const EMAIL_VERIFICATION_RESEND_COOLDOWN_SECONDS = 60;

export const passwordSchema = z.string().min(12).max(128);
export const emailSchema = z
  .string()
  .email()
  .max(254)
  .transform((value) => value.toLowerCase());

// A single-line display name, not free-form text. Control characters (newlines,
// tabs, etc.) are rejected because the name flows into many output contexts
// (emails, logs, the UI) where an embedded control character can corrupt
// formatting or be used to inject content. Email is one such sink: a raw newline
// there can fold the subject line or add extra lines to the plain-text body.
export const displayNameSchema = z
  .string()
  .min(1)
  .max(255)
  .regex(/^\P{Cc}+$/u, 'must not contain control characters');

export const signupBodySchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  name: displayNameSchema.optional(),
  invitation_token: z.string().min(1).max(256).optional(),
});

export type SignupBodyDto = z.infer<typeof signupBodySchema>;

export const signupAcceptErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
});

export type SignupAcceptErrorDto = z.infer<typeof signupAcceptErrorSchema>;

export const signupMembershipSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  workspace_id: z.string().uuid(),
});

export type SignupMembershipDto = z.infer<typeof signupMembershipSchema>;

export const signupResponseSchema = z.object({
  user: userDtoSchema,
  token: z.string().optional(),
  membership: signupMembershipSchema.nullable().optional(),
  accept_error: signupAcceptErrorSchema.optional(),
});

export type SignupResponseDto = z.infer<typeof signupResponseSchema>;

export const loginBodySchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
});

export type LoginBodyDto = z.infer<typeof loginBodySchema>;

export const loginResponseSchema = z.object({
  token: z.string(),
  user: userDtoSchema,
});

export type LoginResponseDto = z.infer<typeof loginResponseSchema>;

export const refreshResponseSchema = loginResponseSchema;

export type RefreshResponseDto = z.infer<typeof refreshResponseSchema>;

export const meResponseSchema = z.object({
  user: userDtoSchema,
});

export type MeResponseDto = z.infer<typeof meResponseSchema>;

export const logoutBodySchema = z.object({});

export type LogoutBodyDto = z.infer<typeof logoutBodySchema>;

export const changePasswordBodySchema = z.object({
  current_password: z.string().min(1).max(128),
  new_password: passwordSchema,
});

export type ChangePasswordBodyDto = z.infer<typeof changePasswordBodySchema>;

export const passwordResetRequestBodySchema = z.object({
  email: emailSchema,
});

export type PasswordResetRequestBodyDto = z.infer<typeof passwordResetRequestBodySchema>;

export const passwordResetConfirmBodySchema = z.object({
  token: z.string().min(1),
  new_password: passwordSchema,
});

export type PasswordResetConfirmBodyDto = z.infer<typeof passwordResetConfirmBodySchema>;

export const passwordResetConfirmResponseSchema = loginResponseSchema;

export type PasswordResetConfirmResponseDto = z.infer<typeof passwordResetConfirmResponseSchema>;

export const verifyEmailConfirmBodySchema = z.object({
  token: z.string().min(1),
});

export type VerifyEmailConfirmBodyDto = z.infer<typeof verifyEmailConfirmBodySchema>;

export const verifyEmailConfirmResponseSchema = loginResponseSchema;

export type VerifyEmailConfirmResponseDto = z.infer<typeof verifyEmailConfirmResponseSchema>;

export const verifyEmailResendBodySchema = z.object({
  email: emailSchema,
});

export type VerifyEmailResendBodyDto = z.infer<typeof verifyEmailResendBodySchema>;

export const verifyEmailResendResponseSchema = z.object({
  next_resend_available_at: z.string().datetime(),
});

export type VerifyEmailResendResponseDto = z.infer<typeof verifyEmailResendResponseSchema>;
