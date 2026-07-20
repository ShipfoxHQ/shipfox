import {extractDisplayPrefix, generateOpaqueToken, hashOpaqueToken} from '@shipfox/node-tokens';
import {
  createProvisionerToken,
  listActiveProvisionerTokens,
  listUsableProvisionerTokensByWorkspaceId,
  revokeInstallationProvisionerToken as revokeInstallationProvisionerTokenDb,
  revokeProvisionerToken,
} from '#db/provisioner-tokens.js';
import {config} from '../config.js';
import type {ActiveProvisionerToken, ProvisionerToken} from './entities/provisioner-token.js';
import {ProvisionerTokenNotFoundError} from './errors.js';

export interface CreateWorkspaceProvisionerTokenParams {
  workspaceId: string;
  createdByUserId: string;
  name?: string | undefined;
  ttlSeconds?: number | undefined;
}

export interface CreateWorkspaceProvisionerTokenResult {
  token: ProvisionerToken;
  rawToken: string;
}

export async function createWorkspaceProvisionerToken(
  params: CreateWorkspaceProvisionerTokenParams,
): Promise<CreateWorkspaceProvisionerTokenResult> {
  const rawToken = generateOpaqueToken('provisionerToken');
  const expiresAt = params.ttlSeconds ? new Date(Date.now() + params.ttlSeconds * 1000) : undefined;

  const token = await createProvisionerToken({
    scope: 'workspace',
    workspaceId: params.workspaceId,
    hashedToken: hashOpaqueToken(rawToken),
    prefix: extractDisplayPrefix(rawToken),
    name: params.name,
    createdByUserId: params.createdByUserId,
    expiresAt,
  });

  return {token, rawToken};
}

export interface CreateInstallationProvisionerTokenParams {
  createdByUserId: string;
  name?: string | undefined;
  ttlSeconds?: number | undefined;
}

export async function createInstallationProvisionerToken(
  params: CreateInstallationProvisionerTokenParams,
): Promise<CreateWorkspaceProvisionerTokenResult> {
  const rawToken = generateOpaqueToken('provisionerToken');
  const expiresAt = params.ttlSeconds ? new Date(Date.now() + params.ttlSeconds * 1000) : undefined;
  const token = await createProvisionerToken({
    scope: 'installation',
    hashedToken: hashOpaqueToken(rawToken),
    prefix: extractDisplayPrefix(rawToken),
    name: params.name,
    createdByUserId: params.createdByUserId,
    expiresAt,
  });
  return {token, rawToken};
}

export function listUsableProvisionerTokens(workspaceId: string): Promise<ProvisionerToken[]> {
  return listUsableProvisionerTokensByWorkspaceId(workspaceId);
}

export function listActiveProvisioners(workspaceId: string): Promise<ActiveProvisionerToken[]> {
  return listActiveProvisionerTokens({
    workspaceId,
    windowSeconds: config.PROVISIONER_ACTIVE_WINDOW_SECONDS,
  });
}

export async function revokeWorkspaceProvisionerToken(params: {
  tokenId: string;
  workspaceId: string;
  revokedByUserId: string;
}): Promise<ProvisionerToken> {
  const token = await revokeProvisionerToken(params);
  if (!token) throw new ProvisionerTokenNotFoundError(params.tokenId);
  return token;
}

export async function revokeInstallationProvisionerToken(params: {
  tokenId: string;
  revokedByUserId: string;
}): Promise<ProvisionerToken> {
  const token = await revokeInstallationProvisionerTokenDb(params);
  if (!token) throw new ProvisionerTokenNotFoundError(params.tokenId);
  return token;
}
