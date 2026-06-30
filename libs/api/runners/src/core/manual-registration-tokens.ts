import {extractDisplayPrefix, generateOpaqueToken, hashOpaqueToken} from '@shipfox/node-tokens';
import {
  createManualRegistrationToken,
  listUsableManualRegistrationTokensByWorkspaceId,
  revokeManualRegistrationToken,
} from '#db/manual-registration-tokens.js';
import type {ManualRegistrationToken} from './entities/manual-registration-token.js';
import {ManualRegistrationTokenNotFoundError} from './errors.js';

export interface CreateWorkspaceManualRegistrationTokenParams {
  workspaceId: string;
  name?: string | undefined;
  ttlSeconds?: number | undefined;
}

export interface CreateWorkspaceManualRegistrationTokenResult {
  token: ManualRegistrationToken;
  rawToken: string;
}

export async function createWorkspaceManualRegistrationToken(
  params: CreateWorkspaceManualRegistrationTokenParams,
): Promise<CreateWorkspaceManualRegistrationTokenResult> {
  const rawToken = generateOpaqueToken('manualRegistrationToken');
  const expiresAt = params.ttlSeconds ? new Date(Date.now() + params.ttlSeconds * 1000) : undefined;

  const token = await createManualRegistrationToken({
    workspaceId: params.workspaceId,
    hashedToken: hashOpaqueToken(rawToken),
    prefix: extractDisplayPrefix(rawToken),
    name: params.name,
    expiresAt,
  });

  return {token, rawToken};
}

export function listUsableManualRegistrationTokens(
  workspaceId: string,
): Promise<ManualRegistrationToken[]> {
  return listUsableManualRegistrationTokensByWorkspaceId(workspaceId);
}

export async function revokeWorkspaceManualRegistrationToken(params: {
  tokenId: string;
  workspaceId: string;
}): Promise<ManualRegistrationToken> {
  const token = await revokeManualRegistrationToken(params);
  if (!token) throw new ManualRegistrationTokenNotFoundError(params.tokenId);
  return token;
}
