import {afterAll, vi} from '@shipfox/vitest/vi';

vi.stubEnv('WORKSPACES_MAX_PER_WORKSPACE', '1');
vi.resetModules();

const {findMembership} = await import('#db/memberships.js');
const {createWorkspaceForUser} = await import('./workspaces.js');
const {closePostgresClient, createPostgresClient} = await import('@shipfox/node-postgres');
createPostgresClient();

afterAll(async () => {
  await closePostgresClient();
  vi.unstubAllEnvs();
  vi.resetModules();
});

test('creates the owner membership through the exempt workspace-creation path', async () => {
  const userId = crypto.randomUUID();
  const workspace = await createWorkspaceForUser({
    name: 'Single-seat workspace',
    slug: `single-seat-${crypto.randomUUID().slice(0, 8)}`,
    userId,
  });

  expect(await findMembership({userId, workspaceId: workspace.id})).toBeDefined();
});
