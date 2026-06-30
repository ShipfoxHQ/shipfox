import {extractDisplayPrefix, generateOpaqueToken, hashOpaqueToken} from '@shipfox/node-tokens';
import {Factory} from 'fishery';
import type {ManualRegistrationToken} from '#core/entities/manual-registration-token.js';
import {createManualRegistrationToken} from '#db/manual-registration-tokens.js';

export interface ManualRegistrationTokenFactoryTransientParams {
  rawToken?: string;
}

export const manualRegistrationTokenFactory = Factory.define<
  ManualRegistrationToken,
  ManualRegistrationTokenFactoryTransientParams
>(({onCreate, transientParams}) => {
  const rawToken = transientParams.rawToken ?? generateOpaqueToken('manualRegistrationToken');

  onCreate((token) => {
    return createManualRegistrationToken({
      workspaceId: token.workspaceId,
      hashedToken: token.hashedToken,
      prefix: token.prefix,
      name: token.name ?? undefined,
      expiresAt: token.expiresAt ?? undefined,
    });
  });

  return {
    id: crypto.randomUUID(),
    workspaceId: crypto.randomUUID(),
    hashedToken: hashOpaqueToken(rawToken),
    prefix: extractDisplayPrefix(rawToken),
    name: 'test runner',
    expiresAt: null,
    revokedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
});
