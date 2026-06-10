import {z} from 'zod';

const checkoutTokenBasicAuthSchema = z.object({
  kind: z.literal('basic'),
  username: z.string(),
  token: z.string(),
  expires_at: z.string().datetime(),
});

const checkoutTokenBearerAuthSchema = z.object({
  kind: z.literal('bearer'),
  token: z.string(),
  expires_at: z.string().datetime(),
});

export const checkoutTokenAuthSchema = z.discriminatedUnion('kind', [
  checkoutTokenBasicAuthSchema,
  checkoutTokenBearerAuthSchema,
]);

export type CheckoutTokenAuthDto = z.infer<typeof checkoutTokenAuthSchema>;

export const checkoutTokenResponseSchema = z.object({
  repository_url: z.string(),
  ref: z.string(),
  auth: checkoutTokenAuthSchema,
});

export type CheckoutTokenResponseDto = z.infer<typeof checkoutTokenResponseSchema>;
