import * as postgres from '@shipfox/node-postgres';
import {afterAll, vi} from '@shipfox/vitest/vi';

vi.stubEnv('WORKSPACES_MAX_PER_WORKSPACE', '1');
vi.resetModules();
vi.doMock('@shipfox/node-postgres', () => postgres);

const {findMembership} = await import('#db/memberships.js');
const {createWorkspaceForUser} = await import('./workspaces.js');

afterAll(() => {
  vi.unstubAllEnvs();
  vi.doUnmock('@shipfox/node-postgres');
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
