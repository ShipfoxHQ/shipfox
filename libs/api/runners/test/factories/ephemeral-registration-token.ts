import {extractDisplayPrefix, generateOpaqueToken, hashOpaqueToken} from '@shipfox/node-tokens';
import {Factory} from 'fishery';
import type {EphemeralRegistrationToken} from '#core/entities/ephemeral-registration-token.js';
import {createEphemeralRegistrationToken} from '#db/ephemeral-registration-tokens.js';

export interface EphemeralRegistrationTokenFactoryTransientParams {
  rawToken?: string;
}

export const ephemeralRegistrationTokenFactory = Factory.define<
  EphemeralRegistrationToken,
  EphemeralRegistrationTokenFactoryTransientParams
>(({onCreate, transientParams}) => {
  const rawToken = transientParams.rawToken ?? generateOpaqueToken('ephemeralRegistrationToken');

  onCreate((token) => {
    return createEphemeralRegistrationToken({
      workspaceId: token.workspaceId,
      provisionerId: token.provisionerId,
      reservationId: token.reservationId,
      providerRunnerId: token.providerRunnerId,
      hashedToken: token.hashedToken,
      prefix: token.prefix,
      expiresAt: token.expiresAt,
    });
  });

  return {
    id: crypto.randomUUID(),
    workspaceId: crypto.randomUUID(),
    provisionerId: crypto.randomUUID(),
    reservationId: null,
    providerRunnerId: `provisioned-runner-${crypto.randomUUID()}`,
    hashedToken: hashOpaqueToken(rawToken),
    prefix: extractDisplayPrefix(rawToken),
    expiresAt: new Date(Date.now() + 60_000),
    consumedAt: null,
    consumedSessionId: null,
    createdAt: new Date(),
  };
});
