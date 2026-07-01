import {z} from 'zod';

const checkoutTokenBasicAuthSchema = z.object({
  kind: z.literal('basic'),
  username: z.string().min(1),
  token: z.string().min(1),
  expires_at: z.string().datetime({offset: true}),
});

const checkoutTokenBearerAuthSchema = z.object({
  kind: z.literal('bearer'),
  token: z.string().min(1),
  expires_at: z.string().datetime({offset: true}),
});

export const checkoutTokenAuthSchema = z.discriminatedUnion('kind', [
  checkoutTokenBasicAuthSchema,
  checkoutTokenBearerAuthSchema,
]);

export type CheckoutTokenAuthDto = z.infer<typeof checkoutTokenAuthSchema>;

export const checkoutTokenPermissionsSchema = z.object({
  contents: z.enum(['read', 'write']),
});

export const checkoutTokenResponseSchema = z.object({
  repository_url: z.string().min(1),
  ref: z.string().min(1),
  // Optional: credential-free providers (e.g. the debug source control) return a
  // public clone URL with no auth material, so the runner clones without a token.
  auth: checkoutTokenAuthSchema.optional(),
  permissions: checkoutTokenPermissionsSchema.optional(),
  ephemeral: z.boolean().optional(),
});

export type CheckoutTokenResponseDto = z.infer<typeof checkoutTokenResponseSchema>;
