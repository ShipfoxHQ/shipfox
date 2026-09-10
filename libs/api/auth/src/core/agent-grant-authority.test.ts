import {
  type WorkspacesInterModuleClient,
  workspacesInterModuleContract,
} from '@shipfox/api-workspaces-dto/inter-module';
import {createInterModuleKnownError} from '@shipfox/inter-module';
import {eq} from 'drizzle-orm';
import {createAgentClient, createAgentGrant} from '#db/agent-access.js';
import {db} from '#db/db.js';
import {agentGrants} from '#db/schema/agent-access.js';
import {users} from '#db/schema/users.js';
import {userFactory} from '#test/index.js';
import {checkAgentGrantAuthority} from './agent-grant-authority.js';
import {AgentGrantAuthorityRevokedError} from './errors.js';

function workspaceClient(params: {
  workspaceId: string;
  userId: string;
  status?: 'active' | 'suspended' | 'deleted';
  hasMembership?: boolean;
  resolveWithoutMembership?: boolean;
  outage?: boolean;
}): WorkspacesInterModuleClient {
  const memberships =
    params.hasMembership === false
      ? []
      : [
          {
            workspaceId: params.workspaceId,
            role: 'admin' as const,
            workspaceStatus: params.status ?? 'active',
          },
        ];
  return {
    listMembershipsForTokenClaims: () =>
      params.outage
        ? Promise.reject(new Error('workspaces unavailable'))
        : Promise.resolve({memberships}),
    requireActiveMembership: () => {
      if (params.outage) return Promise.reject(new Error('workspaces unavailable'));
      if (params.hasMembership === false && !params.resolveWithoutMembership) {
        return Promise.reject(
          createInterModuleKnownError(
            workspacesInterModuleContract.methods.requireActiveMembership,
            'membership-required',
            {workspaceId: params.workspaceId},
          ),
        );
      }
      if (params.status === 'deleted') {
        return Promise.reject(
          createInterModuleKnownError(
            workspacesInterModuleContract.methods.requireActiveMembership,
            'workspace-inactive',
            {workspaceId: params.workspaceId},
          ),
        );
      }
      if (params.status !== undefined && params.status !== 'active') {
        return Promise.reject(
          createInterModuleKnownError(
            workspacesInterModuleContract.methods.requireActiveMembership,
            'workspace-inactive',
            {workspaceId: params.workspaceId},
          ),
        );
      }
      return Promise.resolve({});
    },
    getWorkspaceCreator: async () => ({creatorUserId: null}),
    getWorkspaceOperatingState: async () => ({status: 'active'}),
    preflightInvitationAcceptance: async () => ({}),
    acceptInvitation: async () => ({
      membership: {id: crypto.randomUUID(), userId: params.userId, workspaceId: params.workspaceId},
    }),
  };
}

async function activeGrant() {
  const user = await userFactory.create();
  const workspaceId = crypto.randomUUID();
  const client = await createAgentClient({
    clientId: `https://client.example.test/${crypto.randomUUID()}`,
    name: 'Test client',
    redirectUris: ['https://client.example.test/callback'],
    kind: 'registered',
  });
  const grant = await createAgentGrant({
    userId: user.id,
    workspaceId,
    clientId: client.id,
    scopes: ['read'],
  });
  return {user, workspaceId, grant};
}

describe('agent grant authority', () => {
  test('accepts an active grant, user, membership, and workspace', async () => {
    const {user, workspaceId, grant} = await activeGrant();

    await expect(
      checkAgentGrantAuthority({
        grantId: grant.id,
        userId: user.id,
        workspaceId,
        workspaces: workspaceClient({workspaceId, userId: user.id}),
      }),
    ).resolves.toEqual({ok: true});
  });

  test.each([
    ['grant-revoked', 'grant-revoked'],
    ['user-inactive', 'user-inactive'],
    ['membership-revoked', 'membership-revoked'],
    ['workspace-suspended', 'workspace-suspended'],
    ['workspace-deleted', 'workspace-deleted'],
  ] as const)('returns %s', async (_label, reason) => {
    const {user, workspaceId, grant} = await activeGrant();
    if (reason === 'grant-revoked') {
      await db()
        .update(agentGrants)
        .set({revokedAt: new Date()})
        .where(eq(agentGrants.id, grant.id));
    }
    if (reason === 'user-inactive') {
      await db().update(users).set({status: 'suspended'}).where(eq(users.id, user.id));
    }
    let status: 'active' | 'suspended' | 'deleted' = 'active';
    if (reason === 'workspace-suspended') status = 'suspended';
    if (reason === 'workspace-deleted') status = 'deleted';
    const result = await checkAgentGrantAuthority({
      grantId: grant.id,
      userId: user.id,
      workspaceId,
      workspaces: workspaceClient({
        workspaceId,
        userId: user.id,
        status,
        hasMembership: reason !== 'membership-revoked',
        resolveWithoutMembership: reason === 'membership-revoked',
      }),
    }).catch((error: unknown) => error);

    expect(result).toBeInstanceOf(AgentGrantAuthorityRevokedError);
    expect(result).toMatchObject({reason});
  });

  test('rejects a grant with a mismatched user binding', async () => {
    const {user, workspaceId, grant} = await activeGrant();
    const result = await checkAgentGrantAuthority({
      grantId: grant.id,
      userId: crypto.randomUUID(),
      workspaceId,
      workspaces: workspaceClient({workspaceId, userId: user.id}),
    }).catch((error: unknown) => error);

    expect(result).toBeInstanceOf(AgentGrantAuthorityRevokedError);
    expect(result).toMatchObject({reason: 'grant-revoked'});
  });

  test('rejects a grant with a mismatched workspace binding', async () => {
    const {user, workspaceId, grant} = await activeGrant();
    const result = await checkAgentGrantAuthority({
      grantId: grant.id,
      userId: user.id,
      workspaceId: crypto.randomUUID(),
      workspaces: workspaceClient({workspaceId, userId: user.id}),
    }).catch((error: unknown) => error);

    expect(result).toBeInstanceOf(AgentGrantAuthorityRevokedError);
    expect(result).toMatchObject({reason: 'grant-revoked'});
  });

  test('rejects an active grant with a terminal timestamp', async () => {
    const {user, workspaceId, grant} = await activeGrant();
    await db()
      .update(agentGrants)
      .set({terminalAt: new Date()})
      .where(eq(agentGrants.id, grant.id));

    const result = await checkAgentGrantAuthority({
      grantId: grant.id,
      userId: user.id,
      workspaceId,
      workspaces: workspaceClient({workspaceId, userId: user.id}),
    }).catch((error: unknown) => error);

    expect(result).toBeInstanceOf(AgentGrantAuthorityRevokedError);
    expect(result).toMatchObject({reason: 'grant-revoked'});
  });

  test('surfaces a workspaces outage as a dependency failure', async () => {
    const {user, workspaceId, grant} = await activeGrant();

    await expect(
      checkAgentGrantAuthority({
        grantId: grant.id,
        userId: user.id,
        workspaceId,
        workspaces: workspaceClient({workspaceId, userId: user.id, outage: true}),
      }),
    ).rejects.toMatchObject({name: 'AuthDependencyUnavailableError'});
  });
});
