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
  provisionedRunnerId: string;
  reservationId?: string | null | undefined;
  ttlSeconds: number;
}

export interface MintEphemeralRegistrationTokenResult {
  token: EphemeralRegistrationToken;
  rawToken: string;
}

export interface MintEphemeralRegistrationTokensBatchProvisionedRunner {
  provisionedRunnerId: string;
}

export interface MintEphemeralRegistrationTokensBatchParams {
  workspaceId: string;
  provisionerId: string;
  reservationId: string;
  provisionedRunners: MintEphemeralRegistrationTokensBatchProvisionedRunner[];
  ttlSeconds: number;
  maxBatchSize: number;
}

export interface MintEphemeralRegistrationTokensBatchResult {
  provisionedRunnerId: string;
  token: EphemeralRegistrationToken;
  rawToken: string;
}

export async function mintEphemeralRegistrationToken(
  params: MintEphemeralRegistrationTokenParams,
): Promise<MintEphemeralRegistrationTokenResult> {
  const expiresAt = new Date(Date.now() + params.ttlSeconds * 1000);
  const row = buildEphemeralTokenRow(params.provisionedRunnerId, expiresAt);
  const token = await createEphemeralRegistrationToken({
    workspaceId: params.workspaceId,
    provisionerId: params.provisionerId,
    reservationId: params.reservationId ?? null,
    provisionedRunnerId: params.provisionedRunnerId,
    hashedToken: row.hashedToken,
    prefix: row.prefix,
    expiresAt: row.expiresAt,
  });

  return {token, rawToken: row.rawToken};
}

export async function mintEphemeralRegistrationTokensBatch(
  params: MintEphemeralRegistrationTokensBatchParams,
): Promise<MintEphemeralRegistrationTokensBatchResult[]> {
  if (params.provisionedRunners.length > params.maxBatchSize) {
    throw new RegistrationTokenBatchTooLargeError(
      params.provisionedRunners.length,
      params.maxBatchSize,
    );
  }

  const expiresAt = new Date(Date.now() + params.ttlSeconds * 1000);
  const rows = params.provisionedRunners.map((provisionedRunner) =>
    buildEphemeralTokenRow(provisionedRunner.provisionedRunnerId, expiresAt),
  );
  const tokens = await createEphemeralRegistrationTokensBatch({
    workspaceId: params.workspaceId,
    provisionerId: params.provisionerId,
    reservationId: params.reservationId,
    expiresAt,
    rows,
  });
  const tokensByProvisionedRunnerId = new Map(
    tokens.map((token) => [token.provisionedRunnerId, token]),
  );

  return rows.map((row) => {
    const token = tokensByProvisionedRunnerId.get(row.provisionedRunnerId);
    if (!token) {
      throw new Error(
        `Inserted token not returned for provisioned runner: ${row.provisionedRunnerId}`,
      );
    }
    return {provisionedRunnerId: row.provisionedRunnerId, rawToken: row.rawToken, token};
  });
}

interface EphemeralTokenRow {
  provisionedRunnerId: string;
  rawToken: string;
  hashedToken: string;
  prefix: string;
  expiresAt: Date;
}

function buildEphemeralTokenRow(provisionedRunnerId: string, expiresAt: Date): EphemeralTokenRow {
  const rawToken = generateOpaqueToken('ephemeralRegistrationToken');
  return {
    provisionedRunnerId,
    rawToken,
    hashedToken: hashOpaqueToken(rawToken),
    prefix: extractDisplayPrefix(rawToken),
    expiresAt,
  };
}
