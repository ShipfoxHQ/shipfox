import './env.js';
import {closePostgresClient, createPostgresClient} from '@shipfox/node-postgres';
import {afterAll, afterEach, beforeAll, vi} from '@shipfox/vitest/vi';
import {closeDb} from '#db/index.js';
import {agentTestSecretsClient, resetAgentTestSecrets} from '#test/fixtures/secrets-client.js';

vi.doMock('#core/secrets-client.js', () => {
  return {
    requireAgentSecretsClient: (client: unknown) => client ?? agentTestSecretsClient,
  };
});

beforeAll(() => {
  createPostgresClient();
});

afterEach(() => {
  vi.restoreAllMocks();
  resetAgentTestSecrets();
});

afterAll(async () => {
  closeDb();
  await closePostgresClient();
});
