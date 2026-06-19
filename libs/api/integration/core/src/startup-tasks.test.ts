import {INTEGRATION_SOURCE_COMMIT_PUSHED} from '@shipfox/api-integration-core-dto';
import * as debugModule from '@shipfox/api-integration-debug';
import {createDebugIntegrationProvider} from '@shipfox/api-integration-debug';
import {sql} from 'drizzle-orm';
import {upsertIntegrationConnection} from '#db/connections.js';
import {db} from '#db/db.js';
import {integrationsOutbox} from '#db/schema/outbox.js';
import {createIntegrationsContext} from './index.js';

vi.mock('@shipfox/api-integration-debug', async (importActual) => {
  const actual = await importActual<typeof import('@shipfox/api-integration-debug')>();
  return {
    ...actual,
    emitDebugStartupResync: vi.fn(actual.emitDebugStartupResync),
  };
});

function outboxForConnection(connectionId: string) {
  return db()
    .select()
    .from(integrationsOutbox)
    .where(sql`${integrationsOutbox.payload}->>'connectionId' = ${connectionId}`);
}

function debugProvider() {
  return createDebugIntegrationProvider({upsertIntegrationConnection});
}

describe('createIntegrationsContext runStartupTasks', () => {
  let workspaceId: string;

  beforeEach(() => {
    workspaceId = crypto.randomUUID();
  });

  it('emits a debug source-commit-pushed for each active debug connection when enabled', async () => {
    const connection = await upsertIntegrationConnection({
      workspaceId,
      provider: 'debug',
      externalAccountId: 'debug',
      displayName: 'Debug',
    });
    const context = await createIntegrationsContext({providers: [debugProvider()]});

    await context.runStartupTasks();

    const outbox = await outboxForConnection(connection.id);
    expect(outbox).toHaveLength(1);
    expect(outbox[0]?.eventType).toBe(INTEGRATION_SOURCE_COMMIT_PUSHED);
    expect(outbox[0]?.payload).toMatchObject({
      provider: 'debug',
      push: {externalRepositoryId: 'debug:platform', isDefaultBranch: true},
    });
  });

  it('does nothing when the debug provider is not registered', async () => {
    const connection = await upsertIntegrationConnection({
      workspaceId,
      provider: 'debug',
      externalAccountId: 'debug',
      displayName: 'Debug',
    });
    const context = await createIntegrationsContext({providers: []});

    await context.runStartupTasks();

    expect(await outboxForConnection(connection.id)).toHaveLength(0);
  });

  it('skips disabled debug connections', async () => {
    const connection = await upsertIntegrationConnection({
      workspaceId,
      provider: 'debug',
      externalAccountId: 'debug',
      displayName: 'Debug',
      lifecycleStatus: 'disabled',
    });
    const context = await createIntegrationsContext({providers: [debugProvider()]});

    await context.runStartupTasks();

    expect(await outboxForConnection(connection.id)).toHaveLength(0);
  });

  it('swallows and logs a re-sync failure instead of crashing boot', async () => {
    vi.mocked(debugModule.emitDebugStartupResync).mockRejectedValueOnce(new Error('boom'));
    const context = await createIntegrationsContext({providers: [debugProvider()]});

    await expect(context.runStartupTasks()).resolves.toBeUndefined();
  });
});
