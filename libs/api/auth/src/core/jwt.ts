import {workspaceRoleSchema, workspaceStatusSchema} from '@shipfox/api-workspaces-dto';
import {signHs256, verifyHs256} from '@shipfox/node-jwt';
import {z} from 'zod';
import {recordTokenIssued, recordTokenVerified} from '#metrics/index.js';

export const tokenMembershipSchema = z.object({
  workspaceId: z.string().uuid(),
  // Absent in tokens issued before the slug claim existed; callers fall back to getWorkspaceSummary.
  workspaceSlug: z.string().min(1).optional(),
  role: workspaceRoleSchema,
  workspaceStatus: workspaceStatusSchema.default('active'),
});

export type TokenMembership = z.infer<typeof tokenMembershipSchema>;

const impersonatorIdSchema = z.string().uuid();

// Rollback hazard: pre-impersonation verifiers strip unknown claims (zod's
// default object parsing), so a marked token verified by an old build silently
// loses the marker. Upgrade every verifier before any issuer mints marked tokens.
// `impersonatorId` equals `sub` on a workspace window: the administrator acts as
// themself, and the marker is what the guards key on.
export const userTokenClaimsSchema = z.object({
  sub: z.string().uuid(),
  refreshSessionId: z.string().uuid().optional(),
  impersonatorId: impersonatorIdSchema.optional(),
  email: z.string().email(),
  name: z.string().nullable().optional(),
  memberships: z.array(tokenMembershipSchema),
  iat: z.number().int(),
  exp: z.number().int(),
  jti: z.string().uuid().optional(),
});

export type UserTokenClaims = z.infer<typeof userTokenClaimsSchema>;

export interface SignUserTokenParams {
  refreshSessionId?: string | undefined;
  impersonatorId?: string | undefined;
  userId: string;
  email: string;
  name?: string | null | undefined;
  memberships: TokenMembership[];
  jti?: string | undefined;
  secret: string | Uint8Array;
  expiresIn: string;
}

export interface VerifyUserTokenParams {
  token: string;
  secret: string | Uint8Array;
}

export async function signUserToken(params: SignUserTokenParams): Promise<string> {
  if (
    params.impersonatorId !== undefined &&
    !impersonatorIdSchema.safeParse(params.impersonatorId).success
  ) {
    throw new TypeError('impersonatorId must be a UUID');
  }

  const token = await signHs256({
    payload: {
      email: params.email,
      name: params.name ?? null,
      memberships: params.memberships,
      refreshSessionId: params.refreshSessionId,
      impersonatorId: params.impersonatorId,
      jti: params.jti,
    },
    secret: params.secret,
    expiresIn: params.expiresIn,
    subject: params.userId,
  });
  recordTokenIssued('session');
  return token;
}

export async function verifyUserToken(params: VerifyUserTokenParams): Promise<UserTokenClaims> {
  try {
    const claims = await verifyHs256({
      token: params.token,
      secret: params.secret,
      schema: userTokenClaimsSchema,
    });
    recordTokenVerified('session', 'ok');
    return claims;
  } catch (error) {
    recordTokenVerified('session', 'rejected');
    throw error;
  }
}
