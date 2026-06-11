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

export const checkoutTokenResponseSchema = z.object({
  repository_url: z.string().min(1),
  ref: z.string().min(1),
  auth: checkoutTokenAuthSchema,
});

export type CheckoutTokenResponseDto = z.infer<typeof checkoutTokenResponseSchema>;
