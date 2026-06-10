import {workspaceRoleSchema} from '@shipfox/api-workspaces-dto';
import {signHs256, verifyHs256} from '@shipfox/node-jwt';
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

export async function signUserToken(params: SignUserTokenParams): Promise<string> {
  return await signHs256({
    payload: {
      email: params.email,
      name: params.name ?? null,
      memberships: params.memberships,
    },
    secret: params.secret,
    expiresIn: params.expiresIn,
    subject: params.userId,
  });
}

export async function verifyUserToken(params: VerifyUserTokenParams): Promise<UserTokenClaims> {
  return await verifyHs256({
    token: params.token,
    secret: params.secret,
    schema: userTokenClaimsSchema,
  });
}
