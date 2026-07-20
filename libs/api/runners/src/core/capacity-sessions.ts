import {extractDisplayPrefix, generateOpaqueToken, hashOpaqueToken} from '@shipfox/node-tokens';
import {
  consumeCapacityBootstrapCredential,
  createCapacityBootstrapCredential,
  createPlannedCapacityWithBootstrapCredential as createPlannedCapacityWithBootstrapCredentialDb,
  declareCapacity as declareCapacityDb,
} from '#db/index.js';

export async function issueCapacityBootstrapCredential(params: {
  capacityId: string;
  provisionerId: string;
  ttlSeconds: number;
}): Promise<string> {
  const rawToken = generateOpaqueToken('capacityBootstrapCredential');
  await createCapacityBootstrapCredential({
    capacityId: params.capacityId,
    provisionerId: params.provisionerId,
    hashedToken: hashOpaqueToken(rawToken),
    prefix: extractDisplayPrefix(rawToken),
    expiresAt: new Date(Date.now() + params.ttlSeconds * 1000),
  });
  return rawToken;
}

export async function createPlannedCapacityWithBootstrapCredential(params: {
  provisionerId: string;
  providerKind: string | null;
  templateKey: string | null;
  ttlSeconds: number;
}): Promise<{capacityId: string; bootstrapCredential: string}> {
  const bootstrapCredential = generateOpaqueToken('capacityBootstrapCredential');
  const result = await createPlannedCapacityWithBootstrapCredentialDb({
    provisionerId: params.provisionerId,
    providerKind: params.providerKind,
    templateKey: params.templateKey,
    hashedToken: hashOpaqueToken(bootstrapCredential),
    prefix: extractDisplayPrefix(bootstrapCredential),
    expiresAt: new Date(Date.now() + params.ttlSeconds * 1000),
  });
  return {capacityId: result.capacityId, bootstrapCredential};
}

export async function exchangeCapacityBootstrapCredential(rawToken: string, ttlSeconds: number) {
  const sessionToken = generateOpaqueToken('capacitySession');
  const session = await consumeCapacityBootstrapCredential({
    hashedToken: hashOpaqueToken(rawToken),
    sessionHashedToken: hashOpaqueToken(sessionToken),
    sessionPrefix: extractDisplayPrefix(sessionToken),
    sessionExpiresAt: new Date(Date.now() + ttlSeconds * 1000),
  });
  return session ? {sessionToken, ...session} : null;
}

export function declareCapacity(params: {
  capacityId: string;
  provisionerId: string;
  labels: string[];
  providerKind: string | null;
}): Promise<boolean> {
  return declareCapacityDb(params);
}
