import {
  buildUserContext,
  setUserContext,
  type UserContextMembership,
} from '@shipfox/api-auth-context';
import {ClientError} from '@shipfox/node-fastify';
import type {FastifyRequest} from 'fastify';
import {createMembership} from '#db/memberships.js';
import {createWorkspace, updateWorkspace} from '#db/workspaces.js';
import {requireMembership} from './require-membership.js';

function buildRequest(params: {
  userId: string;
  email: string;
  memberships?: ReadonlyArray<UserContextMembership>;
}): FastifyRequest {
  const request = {} as FastifyRequest;
  setUserContext(
    request,
    buildUserContext({
      userId: params.userId,
      email: params.email,
      memberships: params.memberships,
    }),
  );
  return request;
}

function emailFor(suffix: string): string {
  return `${suffix}-${crypto.randomUUID()}@example.com`;
}

async function createUser(params: {email: string; hashedPassword?: string; name?: string}) {
  await Promise.resolve();
  return {userId: crypto.randomUUID(), email: params.email};
}

describe('requireMembership', () => {
  test('allows when caller has the workspace in token memberships', async () => {
    const user = await createUser({email: emailFor('req-ok')});
    const workspace = await createWorkspace({name: `Workspace ${crypto.randomUUID()}`});
    await createMembership({userId: user.userId, workspaceId: workspace.id});

    const result = await requireMembership({
      request: buildRequest({
        userId: user.userId,
        email: user.email,
        memberships: [{workspaceId: workspace.id, role: 'admin'}],
      }),
      workspaceId: workspace.id,
    });

    expect(result.workspaceId).toBe(workspace.id);
    expect(result.userId).toBe(user.userId);
    expect(result.workspace.name).toBe(workspace.name);
    expect(result.role).toBe('admin');
  });

  test('does not query the memberships table when token already has access', async () => {
    const user = await createUser({email: emailFor('req-no-db')});
    const workspace = await createWorkspace({name: `Workspace ${crypto.randomUUID()}`});

    // Note: NO membership row inserted. Token alone must grant access.
    const result = await requireMembership({
      request: buildRequest({
        userId: user.userId,
        email: user.email,
        memberships: [{workspaceId: workspace.id, role: 'admin'}],
      }),
      workspaceId: workspace.id,
    });

    expect(result.workspaceId).toBe(workspace.id);
    expect(result.role).toBe('admin');
  });

  test('throws 403 when token does not include the workspace', async () => {
    const user = await createUser({email: emailFor('req-no')});
    const workspace = await createWorkspace({name: `Workspace ${crypto.randomUUID()}`});

    const promise = requireMembership({
      request: buildRequest({userId: user.userId, email: user.email, memberships: []}),
      workspaceId: workspace.id,
    });

    await expect(promise).rejects.toBeInstanceOf(ClientError);
    await promise.catch((error: ClientError) => {
      expect(error.status).toBe(403);
    });
  });

  test('throws 403 with workspace-inactive when workspace is suspended', async () => {
    const user = await createUser({email: emailFor('req-suspended')});
    const workspace = await createWorkspace({name: `Workspace ${crypto.randomUUID()}`});
    await updateWorkspace({id: workspace.id, status: 'suspended'});

    const promise = requireMembership({
      request: buildRequest({
        userId: user.userId,
        email: user.email,
        memberships: [{workspaceId: workspace.id, role: 'admin'}],
      }),
      workspaceId: workspace.id,
    });

    await expect(promise).rejects.toBeInstanceOf(ClientError);
    await promise.catch((error: ClientError) => {
      expect(error.status).toBe(403);
      expect(error.code).toBe('workspace-inactive');
    });
  });

  test('throws 404 when workspace does not exist (despite token claim)', async () => {
    const user = await createUser({email: emailFor('req-tn')});
    const ghostWorkspaceId = crypto.randomUUID();

    const promise = requireMembership({
      request: buildRequest({
        userId: user.userId,
        email: user.email,
        memberships: [{workspaceId: ghostWorkspaceId, role: 'admin'}],
      }),
      workspaceId: ghostWorkspaceId,
    });

    await expect(promise).rejects.toBeInstanceOf(ClientError);
    await promise.catch((error: ClientError) => {
      expect(error.status).toBe(404);
    });
  });

  test('throws 401 when client context is absent', async () => {
    const workspace = await createWorkspace({name: `Workspace ${crypto.randomUUID()}`});

    const promise = requireMembership({
      request: {} as unknown as FastifyRequest,
      workspaceId: workspace.id,
    });

    await expect(promise).rejects.toBeInstanceOf(ClientError);
    await promise.catch((error: ClientError) => {
      expect(error.status).toBe(401);
    });
  });
});
