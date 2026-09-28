import {authInterModuleContract} from '@shipfox/api-auth-dto/inter-module';
import type {WorkspacesInterModuleClient} from '@shipfox/api-workspaces-dto/inter-module';
import {isInterModuleKnownError} from '@shipfox/inter-module';
import {createInMemoryInterModuleTransport} from '@shipfox/node-module/inter-module';
import {eq} from 'drizzle-orm';
import {createAdminGrant} from '#db/admin-grants.js';
import {db} from '#db/db.js';
import {users} from '#db/schema/users.js';
import {userFactory} from '#test/index.js';
import {createAuthInterModulePresentation} from './inter-module.js';

const workspaces = {
  listMembershipsForTokenClaims: vi.fn(),
  getWorkspaceCreator: vi.fn(),
  getWorkspaceOperatingState: vi.fn(),
  preflightInvitationAcceptance: vi.fn(),
  acceptInvitation: vi.fn(),
  requireActiveMembership: vi.fn(),
} as unknown as WorkspacesInterModuleClient;

function createClient() {
  const transport = createInMemoryInterModuleTransport();
  const client = transport.createClient(authInterModuleContract);
  transport.register(createAuthInterModulePresentation(workspaces));
  transport.seal();
  return client;
}

describe('Auth inter-module administration role presentation', () => {
  test('returns a minimal user summary from Auth storage', async () => {
    const client = createClient();
    const user = await userFactory.create({name: 'Summary User'});

    await expect(client.getUserSummary({userId: user.id})).resolves.toEqual({
      id: user.id,
      email: user.email,
      name: 'Summary User',
    });
  });

  test('returns undefined for a missing user summary', async () => {
    const client = createClient();

    await expect(client.getUserSummary({userId: crypto.randomUUID()})).resolves.toBeUndefined();
  });

  test('returns a user summary by email', async () => {
    const client = createClient();
    const user = await userFactory.create({name: 'Email Summary User'});

    await expect(client.getUserSummaryByEmail({email: user.email})).resolves.toEqual({
      id: user.id,
      email: user.email,
      name: 'Email Summary User',
    });
  });

  test('returns null for a missing email summary', async () => {
    const client = createClient();

    await expect(
      client.getUserSummaryByEmail({email: `missing-${crypto.randomUUID()}@example.com`}),
    ).resolves.toBeNull();
  });

  test('normalizes the email before looking up a summary', async () => {
    const client = createClient();
    const user = await userFactory.create({name: 'Case Summary User'});

    await expect(client.getUserSummaryByEmail({email: user.email.toUpperCase()})).resolves.toEqual({
      id: user.id,
      email: user.email,
      name: 'Case Summary User',
    });
  });

  test('returns null for a deleted user email', async () => {
    const client = createClient();
    const user = await userFactory.create({name: 'Deleted Summary User'});
    await db().update(users).set({status: 'deleted'}).where(eq(users.id, user.id));

    await expect(client.getUserSummaryByEmail({email: user.email})).resolves.toBeNull();
  });

  test('returns the current role from Auth storage', async () => {
    const client = createClient();
    const user = await userFactory.create({emailVerifiedAt: new Date()});
    await createAdminGrant({userId: user.id, role: 'admin-owner'});

    await expect(client.getCurrentAdminRole({userId: user.id})).resolves.toEqual({
      role: 'admin-owner',
    });
    await expect(
      client.requireAdminRole({userId: user.id, minimumRole: 'admin-operator'}),
    ).resolves.toEqual({role: 'admin-owner'});
  });

  test('maps an insufficient current role to the declared known error', async () => {
    const client = createClient();
    const user = await userFactory.create({emailVerifiedAt: new Date()});
    await createAdminGrant({userId: user.id, role: 'admin-observer'});

    const error = await client
      .requireAdminRole({userId: user.id, minimumRole: 'admin-owner'})
      .catch((caught: unknown) => caught);

    expect(isInterModuleKnownError(authInterModuleContract.methods.requireAdminRole, error)).toBe(
      true,
    );
    if (isInterModuleKnownError(authInterModuleContract.methods.requireAdminRole, error)) {
      expect(error.code).toBe('admin-role-required');
      expect(error.details).toEqual({requiredRole: 'admin-owner'});
    }
  });
});
