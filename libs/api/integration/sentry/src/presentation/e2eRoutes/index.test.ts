import type {IntegrationConnection} from '@shipfox/api-integration-spi';
import {closeApp, createApp} from '@shipfox/node-fastify';
import {createSentryE2eRoutes} from './index.js';

const WORKSPACE_ID = '00000000-0000-4000-8000-000000000002';

function connection(
  overrides: Partial<IntegrationConnection<'sentry'>> = {},
): IntegrationConnection<'sentry'> {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    workspaceId: WORKSPACE_ID,
    provider: 'sentry',
    externalAccountId: 'installation-uuid',
    slug: 'sentry_acme',
    displayName: 'Sentry Acme',
    lifecycleStatus: 'active',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
    repositoryAccessMode: overrides.repositoryAccessMode ?? 'selected',
  };
}

const payload = {
  workspace_id: WORKSPACE_ID,
  installation_uuid: 'installation-uuid',
  org_slug: 'acme',
  display_name: 'Sentry Acme',
  access_token: 'access-token',
};

describe('Sentry E2E routes', () => {
  afterEach(async () => {
    await closeApp();
  });

  it('creates a connection and stores its token without returning it', async () => {
    const secrets = {setSecrets: vi.fn(() => Promise.resolve())};
    const connectSentryInstallation = vi.fn(() => Promise.resolve(connection()));
    const app = await createApp({
      routes: [
        createSentryE2eRoutes({
          secrets,
          getSentryInstallation: vi.fn(() => Promise.resolve(undefined)),
          getConnectionById: vi.fn(() => Promise.resolve(undefined)),
          connectSentryInstallation,
        }),
      ],
      swagger: false,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/integrations/sentry-connections',
      payload,
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({id: connection().id, provider: 'sentry'});
    expect(response.body).not.toContain('access-token');
    expect(connectSentryInstallation).toHaveBeenCalledWith({
      workspaceId: WORKSPACE_ID,
      installationUuid: 'installation-uuid',
      orgSlug: 'acme',
      displayName: 'Sentry Acme',
    });
    expect(secrets.setSecrets).toHaveBeenCalledWith({
      workspaceId: WORKSPACE_ID,
      namespace: `system/integrations/sentry/${connection().id}`,
      values: {ACCESS_TOKEN: 'access-token', EXPIRES_AT: expect.any(String)},
    });
  });

  it('rejects an installation connected to another workspace', async () => {
    const secrets = {setSecrets: vi.fn(() => Promise.resolve())};
    const connectSentryInstallation = vi.fn(() => Promise.resolve(connection()));
    const app = await createApp({
      routes: [
        createSentryE2eRoutes({
          secrets,
          getSentryInstallation: vi.fn(() =>
            Promise.resolve({connectionId: connection().id} as never),
          ),
          getConnectionById: vi.fn(() =>
            Promise.resolve(connection({workspaceId: '00000000-0000-4000-8000-000000000009'})),
          ),
          connectSentryInstallation,
        }),
      ],
      swagger: false,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/integrations/sentry-connections',
      payload,
    });

    expect(response.statusCode).toBe(409);
    expect(connectSentryInstallation).not.toHaveBeenCalled();
    expect(secrets.setSecrets).not.toHaveBeenCalled();
  });

  it('rejects malformed connection bodies', async () => {
    const app = await createApp({
      routes: [
        createSentryE2eRoutes({
          secrets: {setSecrets: vi.fn(() => Promise.resolve())},
          getSentryInstallation: vi.fn(() => Promise.resolve(undefined)),
          getConnectionById: vi.fn(() => Promise.resolve(undefined)),
          connectSentryInstallation: vi.fn(() => Promise.resolve(connection())),
        }),
      ],
      swagger: false,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/integrations/sentry-connections',
      payload: {workspace_id: 'not-a-uuid'},
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({code: 'validation-error'});
  });
});
