import {extractDisplayPrefix, generateOpaqueToken, hashOpaqueToken} from '@shipfox/node-tokens';
import {
  createEphemeralRegistrationToken,
  createEphemeralRegistrationTokensBatch,
} from '#db/ephemeral-registration-tokens.js';
import type {EphemeralRegistrationToken} from './entities/ephemeral-registration-token.js';
import {RegistrationTokenBatchTooLargeError} from './errors.js';

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

export interface MintEphemeralRegistrationTokensBatchResource {
  resourceId: string;
}

export interface MintEphemeralRegistrationTokensBatchParams {
  workspaceId: string;
  provisionerId: string;
  reservationId: string;
  resources: MintEphemeralRegistrationTokensBatchResource[];
  ttlSeconds: number;
  maxBatchSize: number;
}

export interface MintEphemeralRegistrationTokensBatchResult {
  resourceId: string;
  token: EphemeralRegistrationToken;
  rawToken: string;
}

export async function mintEphemeralRegistrationToken(
  params: MintEphemeralRegistrationTokenParams,
): Promise<MintEphemeralRegistrationTokenResult> {
  const expiresAt = new Date(Date.now() + params.ttlSeconds * 1000);
  const row = buildEphemeralTokenRow(params.resourceId, expiresAt);
  const token = await createEphemeralRegistrationToken({
    workspaceId: params.workspaceId,
    provisionerId: params.provisionerId,
    reservationId: params.reservationId ?? null,
    resourceId: params.resourceId,
    hashedToken: row.hashedToken,
    prefix: row.prefix,
    expiresAt: row.expiresAt,
  });

  return {token, rawToken: row.rawToken};
}

export async function mintEphemeralRegistrationTokensBatch(
  params: MintEphemeralRegistrationTokensBatchParams,
): Promise<MintEphemeralRegistrationTokensBatchResult[]> {
  if (params.resources.length > params.maxBatchSize) {
    throw new RegistrationTokenBatchTooLargeError(params.resources.length, params.maxBatchSize);
  }

  const expiresAt = new Date(Date.now() + params.ttlSeconds * 1000);
  const rows = params.resources.map((resource) =>
    buildEphemeralTokenRow(resource.resourceId, expiresAt),
  );
  const tokens = await createEphemeralRegistrationTokensBatch({
    workspaceId: params.workspaceId,
    provisionerId: params.provisionerId,
    reservationId: params.reservationId,
    expiresAt,
    rows,
  });
  const tokensByResourceId = new Map(tokens.map((token) => [token.resourceId, token]));

  return rows.map((row) => {
    const token = tokensByResourceId.get(row.resourceId);
    if (!token) throw new Error(`Inserted token not returned for resource: ${row.resourceId}`);
    return {resourceId: row.resourceId, rawToken: row.rawToken, token};
  });
}

interface EphemeralTokenRow {
  resourceId: string;
  rawToken: string;
  hashedToken: string;
  prefix: string;
  expiresAt: Date;
}

function buildEphemeralTokenRow(resourceId: string, expiresAt: Date): EphemeralTokenRow {
  const rawToken = generateOpaqueToken('ephemeralRegistrationToken');
  return {
    resourceId,
    rawToken,
    hashedToken: hashOpaqueToken(rawToken),
    prefix: extractDisplayPrefix(rawToken),
    expiresAt,
  };
}
