import {randomUUID} from 'node:crypto';
import {listIntegrationConnectionsResponseSchema} from '@shipfox/api-integration-core-dto';
import {config} from '@shipfox/e2e-core';
import {createJiraConnection, createSentryConnection} from '@shipfox/e2e-setup-integrations';
import {createWorkspace} from '@shipfox/e2e-setup-workspaces';
import {expect, test} from './test.js';

test('creates a Jira connection and lists it for the workspace', async ({request, auth}) => {
  const user = await auth.createUser();
  const workspace = await createWorkspace({
    userId: user.user.id,
    userEmail: user.email,
  });
  const session = await auth.createSession({user_id: user.user.id});
  const cloudId = `jira-cloud-${randomUUID()}`;

  const connection = await createJiraConnection({
    workspaceId: workspace.id,
    cloudId,
    siteUrl: 'https://e2e.atlassian.net',
    siteName: 'E2E Jira',
    authorizingAccountId: `jira-user-${randomUUID()}`,
    displayName: 'Jira E2E',
    accessToken: `jira-access-token-${randomUUID()}`,
    refreshToken: `jira-refresh-token-${randomUUID()}`,
  });

  const response = await request.get(
    `${config.API_URL}/integration-connections?workspace_id=${encodeURIComponent(workspace.id)}`,
    {headers: {authorization: `Bearer ${session.token}`}},
  );
  expect(response.status()).toBe(200);
  const body = listIntegrationConnectionsResponseSchema.parse(await response.json());

  expect(body.connections).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: connection.id,
        workspace_id: workspace.id,
        provider: 'jira',
        external_account_id: cloudId,
        display_name: 'Jira E2E',
        lifecycle_status: 'active',
      }),
    ]),
  );
});

test('creates a Sentry connection and lists it for the workspace', async ({request, auth}) => {
  const user = await auth.createUser();
  const workspace = await createWorkspace({
    userId: user.user.id,
    userEmail: user.email,
  });
  const session = await auth.createSession({user_id: user.user.id});
  const installationUuid = `sentry-installation-${randomUUID()}`;

  const connection = await createSentryConnection({
    workspaceId: workspace.id,
    installationUuid,
    orgSlug: `e2e-${randomUUID()}`,
    displayName: 'Sentry E2E',
    accessToken: `sentry-access-token-${randomUUID()}`,
  });

  const response = await request.get(
    `${config.API_URL}/integration-connections?workspace_id=${encodeURIComponent(workspace.id)}`,
    {headers: {authorization: `Bearer ${session.token}`}},
  );
  expect(response.status()).toBe(200);
  const body = listIntegrationConnectionsResponseSchema.parse(await response.json());

  expect(body.connections).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: connection.id,
        workspace_id: workspace.id,
        provider: 'sentry',
        external_account_id: installationUuid,
        display_name: 'Sentry E2E',
        lifecycle_status: 'active',
      }),
    ]),
  );
});
