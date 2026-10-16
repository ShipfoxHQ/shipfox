import {randomUUID} from 'node:crypto';
import type {IntegrationConnection} from '@shipfox/api-integration-spi';
import type {JamCredentialStore} from './credentials.js';
import type {ValidatedJamToken} from './validate-token.js';

export interface CreateJamConnectionInput extends ValidatedJamToken {
  id: string;
  workspaceId: string;
  token: string;
}

export interface JamConnectionCreator {
  createConnection(input: CreateJamConnectionInput): Promise<IntegrationConnection<'jam'>>;
}

export type JamConnectResult =
  | {status: 'connected'; connection: IntegrationConnection<'jam'>}
  | {status: 'already-connected'; connectionId: string};

export interface HandleJamConnectParams {
  workspaceId: string;
  token: string;
  validateToken: (token: string) => Promise<ValidatedJamToken>;
  credentials: JamCredentialStore;
  getExistingConnection: (input: {
    workspaceId: string;
    externalAccountId: string;
  }) => Promise<IntegrationConnection<'jam'> | undefined>;
  createConnection: JamConnectionCreator['createConnection'];
}

export async function handleJamConnect(params: HandleJamConnectParams): Promise<JamConnectResult> {
  const validated = await params.validateToken(params.token);

  const existing = await params.getExistingConnection({
    workspaceId: params.workspaceId,
    externalAccountId: validated.teamId,
  });
  if (existing) return {status: 'already-connected', connectionId: existing.id};

  const connectionId = randomUUID();
  try {
    await params.credentials.setToken({
      connectionId,
      workspaceId: params.workspaceId,
      token: params.token,
    });
    const connection = await params.createConnection({
      ...validated,
      id: connectionId,
      workspaceId: params.workspaceId,
      token: params.token,
    });
    return {status: 'connected', connection};
  } catch (error) {
    await params.credentials
      .deleteToken({connectionId, workspaceId: params.workspaceId})
      .catch(() => undefined);
    const concurrentConnection = await params.getExistingConnection({
      workspaceId: params.workspaceId,
      externalAccountId: validated.teamId,
    });
    if (concurrentConnection) {
      return {status: 'already-connected', connectionId: concurrentConnection.id};
    }
    throw error;
  }
}
