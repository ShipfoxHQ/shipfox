import {extractDisplayPrefix, generateOpaqueToken, hashOpaqueToken} from '@shipfox/node-tokens';
import {createEphemeralRegistrationToken} from '#db/ephemeral-registration-tokens.js';
import type {EphemeralRegistrationToken} from './entities/ephemeral-registration-token.js';

export interface MintEphemeralRegistrationTokenParams {
  workspaceId: string;
  provisionerId: string;
  resourceId: string;
  reservationId?: string | null | undefined;
  ttlSeconds: number;
}

export interface MintEphemeralRegistrationTokenResult {
  token: EphemeralRegistrationToken;
  rawToken: string;
}

export async function mintEphemeralRegistrationToken(
  params: MintEphemeralRegistrationTokenParams,
): Promise<MintEphemeralRegistrationTokenResult> {
  const rawToken = generateOpaqueToken('ephemeralRegistrationToken');
  const token = await createEphemeralRegistrationToken({
    workspaceId: params.workspaceId,
    provisionerId: params.provisionerId,
    reservationId: params.reservationId ?? null,
    resourceId: params.resourceId,
    hashedToken: hashOpaqueToken(rawToken),
    prefix: extractDisplayPrefix(rawToken),
    expiresAt: new Date(Date.now() + params.ttlSeconds * 1000),
  });

  return {token, rawToken};
}
