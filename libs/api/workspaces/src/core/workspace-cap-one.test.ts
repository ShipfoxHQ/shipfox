import {findMembership} from '#db/memberships.js';
import {createWorkspaceForUser} from './workspaces.js';

test('creates the owner membership through the exempt workspace-creation path', async () => {
  const userId = crypto.randomUUID();
  const workspace = await createWorkspaceForUser({
    name: 'Single-seat workspace',
    slug: `single-seat-${crypto.randomUUID().slice(0, 8)}`,
    userId,
  });

  expect(await findMembership({userId, workspaceId: workspace.id})).toBeDefined();
});
