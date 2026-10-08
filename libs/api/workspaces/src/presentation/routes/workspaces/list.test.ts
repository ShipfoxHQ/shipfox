import {
  buildUserContext,
  setUserContext,
  type UserContextMembership,
} from '@shipfox/api-auth-context';
import type {FastifyInstance} from 'fastify';
import Fastify from 'fastify';
import {serializerCompiler, validatorCompiler} from 'fastify-type-provider-zod';
import {createMembership} from '#db/memberships.js';
import {createWorkspace} from '#db/workspaces.js';
import {listUserWorkspacesRoute} from './list.js';

describe('GET /workspaces', () => {
  let app: FastifyInstance;
  let userId: string;
  let impersonatorId: string | undefined;
  let tokenMemberships: UserContextMembership[];

  beforeAll(async () => {
    app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.addHook('onRequest', (request, _reply, done) => {
      setUserContext(
        request,
        buildUserContext({
          userId,
          email: 'caller@example.com',
          memberships: tokenMemberships,
          impersonatorId,
        }),
      );
      done();
    });
    app.get('/workspaces', listUserWorkspacesRoute);
    await app.ready();
  });

  beforeEach(() => {
    userId = crypto.randomUUID();
    impersonatorId = undefined;
    tokenMemberships = [];
  });

  test('returns the signed-in user workspace memberships', async () => {
    const workspace = await createWorkspace({name: 'Acme'});
    await createMembership({
      userId,
      userEmail: 'caller@example.com',
      workspaceId: workspace.id,
    });

    const res = await app.inject({
      method: 'GET',
      url: '/workspaces',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      memberships: [
        {
          user_id: userId,
          workspace_id: workspace.id,
          workspace_name: 'Acme',
          workspace_slug: workspace.slug,
        },
      ],
    });
  });

  test('lists only the workspace an impersonation window grants', async () => {
    const own = await createWorkspace({name: 'Operator'});
    await createMembership({userId, userEmail: 'caller@example.com', workspaceId: own.id});
    const impersonated = await createWorkspace({name: 'Customer'});
    impersonatorId = userId;
    tokenMemberships = [{workspaceId: impersonated.id, role: 'admin', workspaceStatus: 'active'}];

    const res = await app.inject({method: 'GET', url: '/workspaces'});

    expect(res.statusCode).toBe(200);
    expect(res.json().memberships).toEqual([
      expect.objectContaining({
        user_id: userId,
        workspace_id: impersonated.id,
        workspace_name: 'Customer',
        workspace_slug: impersonated.slug,
        workspace_status: 'active',
      }),
    ]);
  });
});
