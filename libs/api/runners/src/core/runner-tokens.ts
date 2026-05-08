import {extractDisplayPrefix, generateOpaqueToken, hashOpaqueToken} from '@shipfox/node-tokens';
import {
  createRunnerToken,
  listUsableRunnerTokensByWorkspaceId,
  revokeRunnerToken,
} from '#db/runner-tokens.js';
import type {RunnerToken} from './entities/runner-token.js';
import {RunnerTokenNotFoundError} from './errors.js';

export interface CreateWorkspaceRunnerTokenParams {
  workspaceId: string;
  name?: string | undefined;
  ttlSeconds?: number | undefined;
}

export interface CreateWorkspaceRunnerTokenResult {
  token: RunnerToken;
  rawToken: string;
}

export async function createWorkspaceRunnerToken(
  params: CreateWorkspaceRunnerTokenParams,
): Promise<CreateWorkspaceRunnerTokenResult> {
  const rawToken = generateOpaqueToken('runnerToken');
  const expiresAt = params.ttlSeconds ? new Date(Date.now() + params.ttlSeconds * 1000) : undefined;

  const token = await createRunnerToken({
    workspaceId: params.workspaceId,
    hashedToken: hashOpaqueToken(rawToken),
    prefix: extractDisplayPrefix(rawToken),
    name: params.name,
    expiresAt,
  });

  return {token, rawToken};
}

export function listUsableRunnerTokens(workspaceId: string): Promise<RunnerToken[]> {
  return listUsableRunnerTokensByWorkspaceId(workspaceId);
}

export async function revokeWorkspaceRunnerToken(params: {
  tokenId: string;
  workspaceId: string;
}): Promise<RunnerToken> {
  const token = await revokeRunnerToken(params);
  if (!token) throw new RunnerTokenNotFoundError(params.tokenId);
  return token;
}
