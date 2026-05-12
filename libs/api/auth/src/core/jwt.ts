import {workspaceRoleSchema} from '@shipfox/api-workspaces-dto';
import {jwtVerify, SignJWT} from 'jose';
import {z} from 'zod';

export const tokenMembershipSchema = z.object({
  workspaceId: z.string().uuid(),
  role: workspaceRoleSchema,
});

export type TokenMembership = z.infer<typeof tokenMembershipSchema>;

export const userTokenClaimsSchema = z.object({
  sub: z.string().uuid(),
  email: z.string().email(),
  name: z.string().nullable().optional(),
  memberships: z.array(tokenMembershipSchema),
  iat: z.number().int(),
  exp: z.number().int(),
});

export type UserTokenClaims = z.infer<typeof userTokenClaimsSchema>;

export interface SignUserTokenParams {
  userId: string;
  email: string;
  name?: string | null | undefined;
  memberships: TokenMembership[];
  secret: string;
  expiresIn: string;
}

export interface VerifyUserTokenParams {
  token: string;
  secret: string;
}

function encodeSecret(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

export async function signUserToken(params: SignUserTokenParams): Promise<string> {
  return await new SignJWT({
    email: params.email,
    name: params.name ?? null,
    memberships: params.memberships,
  })
    .setProtectedHeader({alg: 'HS256'})
    .setSubject(params.userId)
    .setIssuedAt()
    .setExpirationTime(params.expiresIn)
    .sign(encodeSecret(params.secret));
}

export async function verifyUserToken(params: VerifyUserTokenParams): Promise<UserTokenClaims> {
  const {payload} = await jwtVerify(params.token, encodeSecret(params.secret), {
    algorithms: ['HS256'],
  });

  return userTokenClaimsSchema.parse(payload);
}
