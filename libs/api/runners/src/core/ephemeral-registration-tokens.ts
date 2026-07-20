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
  providerRunnerId: string;
  reservationId?: string | null | undefined;
  ttlSeconds: number;
}

export interface MintEphemeralRegistrationTokenResult {
  token: EphemeralRegistrationToken;
  rawToken: string;
}

export interface MintEphemeralRegistrationTokensBatchRunnerInstance {
  providerRunnerId: string;
}

export interface MintEphemeralRegistrationTokensBatchParams {
  workspaceId: string;
  provisionerId: string;
  reservationId: string;
  providerRunners: MintEphemeralRegistrationTokensBatchRunnerInstance[];
  ttlSeconds: number;
  maxBatchSize: number;
}

export interface MintEphemeralRegistrationTokensBatchResult {
  providerRunnerId: string;
  token: EphemeralRegistrationToken;
  rawToken: string;
}

export async function mintEphemeralRegistrationToken(
  params: MintEphemeralRegistrationTokenParams,
): Promise<MintEphemeralRegistrationTokenResult> {
  const expiresAt = new Date(Date.now() + params.ttlSeconds * 1000);
  const row = buildEphemeralTokenRow(params.providerRunnerId, expiresAt);
  const token = await createEphemeralRegistrationToken({
    workspaceId: params.workspaceId,
    provisionerId: params.provisionerId,
    reservationId: params.reservationId ?? null,
    providerRunnerId: params.providerRunnerId,
    hashedToken: row.hashedToken,
    prefix: row.prefix,
    expiresAt: row.expiresAt,
  });

  return {token, rawToken: row.rawToken};
}

export async function mintEphemeralRegistrationTokensBatch(
  params: MintEphemeralRegistrationTokensBatchParams,
): Promise<MintEphemeralRegistrationTokensBatchResult[]> {
  if (params.providerRunners.length > params.maxBatchSize) {
    throw new RegistrationTokenBatchTooLargeError(
      params.providerRunners.length,
      params.maxBatchSize,
    );
  }

  const expiresAt = new Date(Date.now() + params.ttlSeconds * 1000);
  const rows = params.providerRunners.map((providerRunner) =>
    buildEphemeralTokenRow(providerRunner.providerRunnerId, expiresAt),
  );
  const tokens = await createEphemeralRegistrationTokensBatch({
    workspaceId: params.workspaceId,
    provisionerId: params.provisionerId,
    reservationId: params.reservationId,
    expiresAt,
    rows,
  });
  const tokensByRunnerInstanceId = new Map(tokens.map((token) => [token.providerRunnerId, token]));

  return rows.map((row) => {
    const token = tokensByRunnerInstanceId.get(row.providerRunnerId);
    if (!token) {
      throw new Error(
        `Inserted token not returned for provisioned runner: ${row.providerRunnerId}`,
      );
    }
    return {providerRunnerId: row.providerRunnerId, rawToken: row.rawToken, token};
  });
}

interface EphemeralTokenRow {
  providerRunnerId: string;
  rawToken: string;
  hashedToken: string;
  prefix: string;
  expiresAt: Date;
}

function buildEphemeralTokenRow(providerRunnerId: string, expiresAt: Date): EphemeralTokenRow {
  const rawToken = generateOpaqueToken('ephemeralRegistrationToken');
  return {
    providerRunnerId,
    rawToken,
    hashedToken: hashOpaqueToken(rawToken),
    prefix: extractDisplayPrefix(rawToken),
    expiresAt,
  };
}
