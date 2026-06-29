import {extractDisplayPrefix, generateOpaqueToken, hashOpaqueToken} from '@shipfox/node-tokens';
import {Factory} from 'fishery';
import type {ProvisionerToken} from '#core/entities/provisioner-token.js';
import {createProvisionerToken} from '#db/provisioner-tokens.js';

export interface ProvisionerTokenFactoryTransientParams {
  rawToken?: string;
}

export const provisionerTokenFactory = Factory.define<
  ProvisionerToken,
  ProvisionerTokenFactoryTransientParams
>(({onCreate, transientParams}) => {
  const rawToken = transientParams.rawToken ?? generateOpaqueToken('provisionerToken');

  onCreate((token) => {
    return createProvisionerToken({
      workspaceId: token.workspaceId,
      hashedToken: token.hashedToken,
      prefix: token.prefix,
      name: token.name ?? undefined,
      createdByUserId: token.createdByUserId,
      expiresAt: token.expiresAt ?? undefined,
    });
  });

  return {
    id: crypto.randomUUID(),
    workspaceId: crypto.randomUUID(),
    hashedToken: hashOpaqueToken(rawToken),
    prefix: extractDisplayPrefix(rawToken),
    name: 'test provisioner',
    createdByUserId: crypto.randomUUID(),
    revokedByUserId: null,
    expiresAt: null,
    revokedAt: null,
    lastSeenAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
});
