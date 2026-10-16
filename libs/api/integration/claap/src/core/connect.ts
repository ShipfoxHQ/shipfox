import {randomUUID} from 'node:crypto';
import type {IntegrationConnection} from '@shipfox/api-integration-spi';
import type {ClaapCredentialStore} from './credentials.js';
import {
  ClaapAlreadyConnectedError,
  ClaapApiKeyPrefixError,
  ClaapUnexpectedWorkspaceCountError,
} from './errors.js';
import type {ClaapWorkspace} from './mcp-client.js';

export interface CreateClaapConnectionInput {
  id: string;
  workspaceId: string;
  apiKey: string;
  claapWorkspaceId: string;
  claapWorkspaceName: string;
}

export interface ClaapConnectionCreator {
  createConnection(input: CreateClaapConnectionInput): Promise<IntegrationConnection<'claap'>>;
}

export interface HandleClaapConnectParams {
  workspaceId: string;
  apiKey: string;
  listClaapWorkspaces: (apiKey: string) => Promise<ClaapWorkspace[]>;
  credentials: ClaapCredentialStore;
  getExistingConnection: (input: {
    workspaceId: string;
    externalAccountId: string;
  }) => Promise<IntegrationConnection<'claap'> | undefined>;
  createConnection: ClaapConnectionCreator['createConnection'];
}

export async function handleClaapConnect(
  params: HandleClaapConnectParams,
): Promise<IntegrationConnection<'claap'>> {
  assertClaapApiKey(params.apiKey);
  const workspaces = await params.listClaapWorkspaces(params.apiKey);
  const [claapWorkspace] = workspaces;
  if (!claapWorkspace || workspaces.length !== 1) {
    throw new ClaapUnexpectedWorkspaceCountError(workspaces.length);
  }

  const externalAccountId = claapWorkspace.workspaceId;
  const existing = await params.getExistingConnection({
    workspaceId: params.workspaceId,
    externalAccountId,
  });
  if (existing) throw new ClaapAlreadyConnectedError(existing.id);

  const connectionId = randomUUID();
  try {
    await params.credentials.setApiKey({
      connectionId,
      workspaceId: params.workspaceId,
      apiKey: params.apiKey,
    });
    return await params.createConnection({
      id: connectionId,
      workspaceId: params.workspaceId,
      apiKey: params.apiKey,
      claapWorkspaceId: claapWorkspace.workspaceId,
      claapWorkspaceName: claapWorkspace.name,
    });
  } catch (error) {
    await params.credentials
      .deleteApiKey({connectionId, workspaceId: params.workspaceId})
      .catch(() => undefined);
    const concurrentConnection = await params.getExistingConnection({
      workspaceId: params.workspaceId,
      externalAccountId,
    });
    if (concurrentConnection) throw new ClaapAlreadyConnectedError(concurrentConnection.id);
    throw error;
  }
}

export function assertClaapApiKey(apiKey: string): void {
  if (!apiKey.startsWith('cla_')) throw new ClaapApiKeyPrefixError();
}
