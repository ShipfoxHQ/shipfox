import {INTEGRATION_CONNECTION_AVAILABLE} from '@shipfox/api-integration-core-dto';
import type {CreateSentryIntegrationProviderOptions} from '@shipfox/api-integration-sentry';
import {runMigrations} from '@shipfox/node-drizzle';
import {sql} from 'drizzle-orm';
import {getIntegrationConnectionById, upsertIntegrationConnection} from '#db/connections.js';
import {db} from '#db/db.js';
import {integrationsOutbox} from '#db/schema/outbox.js';
import type {IntegrationModuleParts} from '#providers/types.js';
import {createTestApp, useIntegrationRouteTest} from '#test/route-utils.js';

describe('sentryProviderModule', () => {
  const context = useIntegrationRouteTest();

  afterEach(() => {
    vi.doUnmock('@shipfox/api-integration-sentry');
    vi.resetModules();
  });

  function scopedSecrets() {
    const deleteSecrets = vi.fn(() => Promise.resolve(2));
    return {
      deleteSecrets,
      sentry: {
        getSecret: vi.fn(() => Promise.resolve(null)),
        setSecrets: vi.fn(() => Promise.resolve()),
        deleteSecrets,
      },
    };
  }

  async function loadSentryProviderModule() {
    vi.resetModules();
    const {createPostgresClient} = await import('@shipfox/node-postgres');
    createPostgresClient();
    const {sentryProviderModule} = await import('#providers/sentry.js');
    return sentryProviderModule;
  }

  async function migrate(part: IntegrationModuleParts) {
    if (!part.database) throw new Error('Sentry provider database is not configured');
    await runMigrations(
      part.database.db(),
      part.database.migrationsPath,
      `__drizzle_migrations_${part.database.databaseNamespace}`,
    );
  }

  it('registers the read-only Sentry tool catalog', async () => {
    const sentryProviderModule = await loadSentryProviderModule();
    const secrets = scopedSecrets();

    const part = await sentryProviderModule.load({secrets});

    const catalog = (await part.provider.adapters?.agent_tools?.catalog()) ?? [];
    expect(catalog.map((tool) => [tool.id, tool.sensitivity])).toEqual([
      ['list-projects', 'read'],
      ['search-issues', 'read'],
      ['get-issue', 'read'],
      ['get-issue-event', 'read'],
    ]);
  });

  it('publishes the agent tools capability when a Sentry installation connects', async () => {
    let providerOptions: CreateSentryIntegrationProviderOptions | undefined;
    vi.doMock('@shipfox/api-integration-sentry', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@shipfox/api-integration-sentry')>();
      return {
        ...actual,
        createSentryIntegrationProvider: (options: CreateSentryIntegrationProviderOptions) => {
          providerOptions = options;
          return actual.createSentryIntegrationProvider(options);
        },
      };
    });
    const sentryProviderModule = await loadSentryProviderModule();
    const part = await sentryProviderModule.load({secrets: scopedSecrets()});
    await migrate(part);
    if (!providerOptions) throw new Error('Sentry provider options were not captured');

    const connection = await providerOptions.connectSentryInstallation({
      workspaceId: context.workspaceId,
      installationUuid: crypto.randomUUID(),
      orgSlug: 'acme',
      displayName: 'Sentry Acme',
      installerUserId: crypto.randomUUID(),
      codeHash: 'code-hash',
    });

    const [event] = await db()
      .select({payload: integrationsOutbox.payload})
      .from(integrationsOutbox)
      .where(
        sql`${integrationsOutbox.eventType} = ${INTEGRATION_CONNECTION_AVAILABLE} AND ${integrationsOutbox.payload}->>'connectionId' = ${connection.id}`,
      );
    expect(event?.payload).toMatchObject({provider: 'sentry', capabilities: ['agent_tools']});
  });

  it('deletes stored Sentry tokens through the generic connection route', async () => {
    const sentryProviderModule = await loadSentryProviderModule();
    const secrets = scopedSecrets();
    const part = await sentryProviderModule.load({secrets});
    await migrate(part);
    const app = await createTestApp([part.provider]);
    const connection = await upsertIntegrationConnection({
      workspaceId: context.workspaceId,
      provider: 'sentry',
      externalAccountId: crypto.randomUUID(),
      slug: 'sentry_acme',
      displayName: 'Sentry Acme',
      capabilities: ['agent_tools'],
    });

    const res = await app.inject({
      method: 'DELETE',
      url: `/integration-connections/${connection.id}`,
      headers: {authorization: 'Bearer user'},
    });

    expect(res.statusCode).toBe(204);
    await expect(getIntegrationConnectionById(connection.id)).resolves.toBeUndefined();
    expect(secrets.deleteSecrets).toHaveBeenCalledWith({
      workspaceId: context.workspaceId,
      namespace: connection.id,
    });
  });
});
