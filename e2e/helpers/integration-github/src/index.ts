import {randomInt, randomUUID} from 'node:crypto';
import type {
  E2eCreateIntegrationConnectionResponseDto,
  E2eListIntegrationEventsResponseDto,
} from '@shipfox/api-integration-core-dto';
import type {E2eCreateGithubInstallationResponseDto} from '@shipfox/api-integration-github-dto';
import {request, requestJson} from '@shipfox/e2e-core';
import {signGithubWebhookBody} from './sign.js';

export {signGithubWebhookBody} from './sign.js';

const WEBHOOK_SECRET = process.env.GITHUB_APP_WEBHOOK_SECRET ?? 'test-webhook-secret';

export interface ConnectGithubParams {
  workspaceId: string;
  installationId?: string;
  externalAccountId?: string;
  displayName?: string;
  accountLogin?: string;
}

export interface ConnectedGithub {
  connectionId: string;
  installationId: string;
  externalAccountId: string;
}

export async function connectGithub(params: ConnectGithubParams): Promise<ConnectedGithub> {
  const installationId = params.installationId ?? String(randomInt(1_000_000, 99_999_999));
  const externalAccountId = params.externalAccountId ?? installationId;

  const connectionResponse = await requestJson<E2eCreateIntegrationConnectionResponseDto>(
    'post',
    '/__e2e/integration/connections',
    {
      json: {
        workspace_id: params.workspaceId,
        provider: 'github',
        external_account_id: externalAccountId,
        display_name: params.displayName ?? `e2e-${externalAccountId}`,
      },
    },
  );

  await requestJson<E2eCreateGithubInstallationResponseDto>(
    'post',
    '/__e2e/integration/github/installations',
    {
      json: {
        connection_id: connectionResponse.connection.id,
        installation_id: installationId,
        account_login: params.accountLogin ?? 'e2e-account',
      },
    },
  );

  return {
    connectionId: connectionResponse.connection.id,
    installationId,
    externalAccountId,
  };
}

export interface GithubPushCommit {
  id?: string;
  message?: string;
}

export interface SendSignedPushParams {
  installationId: string;
  repositoryId?: number;
  ref?: string;
  defaultBranch?: string;
  headCommitSha?: string;
  deliveryId?: string;
  commits?: GithubPushCommit[];
}

export interface SendSignedPushResult {
  status: number;
  deliveryId: string;
  headCommitSha: string;
  repositoryId: number;
}

export async function sendSignedPush(params: SendSignedPushParams): Promise<SendSignedPushResult> {
  const deliveryId = params.deliveryId ?? randomUUID();
  const headCommitSha = params.headCommitSha ?? randomUUID().replaceAll('-', '');
  const ref = params.ref ?? 'refs/heads/main';
  const defaultBranch = params.defaultBranch ?? 'main';
  const repositoryId = params.repositoryId ?? randomInt(1, 1_000_000);

  const payload = {
    ref,
    after: headCommitSha,
    repository: {id: repositoryId, default_branch: defaultBranch},
    installation: {id: Number(params.installationId)},
    commits: params.commits ?? [],
  };
  const rawBody = JSON.stringify(payload);

  return await sendRawSignedPush({deliveryId, rawBody, repositoryId, headCommitSha});
}

export interface SendRawSignedPushParams {
  rawBody: string;
  deliveryId: string;
  repositoryId: number;
  headCommitSha: string;
  signature?: string;
  eventHeader?: string;
}

export async function sendRawSignedPush(
  params: SendRawSignedPushParams,
): Promise<SendSignedPushResult> {
  const signature = params.signature ?? signGithubWebhookBody(params.rawBody, WEBHOOK_SECRET);
  const response = await request('post', '/webhooks/integrations/github', {
    body: params.rawBody,
    headers: {
      'content-type': 'application/json',
      'x-hub-signature-256': signature,
      'x-github-event': params.eventHeader ?? 'push',
      'x-github-delivery': params.deliveryId,
    },
    throwHttpErrors: false,
  });

  return {
    status: response.status,
    deliveryId: params.deliveryId,
    repositoryId: params.repositoryId,
    headCommitSha: params.headCommitSha,
  };
}

export interface ReadEventsParams {
  deliveryId?: string;
  eventType?: string;
}

export async function readEvents(
  params: ReadEventsParams = {},
): Promise<E2eListIntegrationEventsResponseDto> {
  const search = new URLSearchParams();
  if (params.deliveryId) search.set('delivery_id', params.deliveryId);
  if (params.eventType) search.set('event_type', params.eventType);

  const query = search.toString();
  const path = query ? `/__e2e/integration/events?${query}` : '/__e2e/integration/events';
  return await requestJson<E2eListIntegrationEventsResponseDto>('get', path, {});
}

export function createIntegrationGithubHelper() {
  return {
    connect: connectGithub,
    sendSignedPush,
    sendRawSignedPush,
    readEvents,
    webhookSecret: WEBHOOK_SECRET,
  };
}

export type IntegrationGithubHelper = ReturnType<typeof createIntegrationGithubHelper>;

export interface IntegrationGithubFixtures {
  integrationGithub: IntegrationGithubHelper;
}

export const integrationGithubHelper = {
  integrationGithub: async (
    {request: _request}: {request: unknown},
    use: (helper: IntegrationGithubHelper) => Promise<void>,
  ) => {
    await use(createIntegrationGithubHelper());
  },
};
