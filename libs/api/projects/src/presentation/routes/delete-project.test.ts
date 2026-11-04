import {
  AUTH_USER,
  buildUserContext,
  setUserContext,
  type UserContextMembership,
} from '@shipfox/api-auth-context';
import type {AuthInterModuleClient} from '@shipfox/api-auth-dto/inter-module';
import type {IntegrationsModuleClient} from '@shipfox/api-integration-core-dto/inter-module';
import type {AuthMethod} from '@shipfox/node-fastify';
import {closeApp, createApp} from '@shipfox/node-fastify';
import {createTestFeatureFlags} from '@shipfox/node-feature-flags/testing';
import {eq, sql} from 'drizzle-orm';
import type {FastifyInstance, FastifyRequest} from 'fastify';
import {db} from '#db/db.js';
import {projectsOutbox} from '#db/schema/outbox.js';
import {projects} from '#db/schema/projects.js';
import {projectFactory} from '#test/index.js';
import {createProjectRoutes} from './index.js';

let memberships: UserContextMembership[] = [];
let impersonatorId: string | undefined;

const fakeUserAuth: AuthMethod = {
  name: AUTH_USER,
  authenticate: (request: FastifyRequest) => {
    setUserContext(
      request,
      buildUserContext({
        userId: 'user-1',
        email: 'user@example.com',
        name: 'User One',
        memberships,
        impersonatorId,
      }),
    );
    return Promise.resolve();
  },
};

describe('DELETE /projects/:projectId', () => {
  let app: FastifyInstance;
  let workspaceId: string;

  beforeEach(async () => {
    await closeApp();
    workspaceId = crypto.randomUUID();
    memberships = [{workspaceId, role: 'admin', workspaceStatus: 'active'}];
    impersonatorId = undefined;
    app = await createApp({
      auth: [fakeUserAuth],
      routes: createProjectRoutes(
        {} as IntegrationsModuleClient,
        {requireAdminRole: vi.fn()} as Pick<AuthInterModuleClient, 'requireAdminRole'>,
        createTestFeatureFlags(),
      ),
      swagger: false,
    });
    await app.ready();
  });

  afterEach(async () => {
    await closeApp();
  });

  function remove(projectId: string, payload: unknown) {
    return app.inject({
      method: 'DELETE',
      url: `/projects/${projectId}`,
      headers: {authorization: 'Bearer user'},
      payload: payload as never,
    });
  }

  function get(projectId: string) {
    return app.inject({
      method: 'GET',
      url: `/projects/${projectId}`,
      headers: {authorization: 'Bearer user'},
    });
  }

  test('deletes the project at once, and every route then answers not-found', async () => {
    const project = await projectFactory.create({workspaceId});

    const res = await remove(project.id, {name: project.name});

    expect(res.statusCode).toBe(204);
    expect((await get(project.id)).statusCode).toBe(404);
    const patch = await app.inject({
      method: 'PATCH',
      url: `/projects/${project.id}`,
      headers: {authorization: 'Bearer user'},
      payload: {name: 'Renamed'},
    });
    expect(patch.statusCode).toBe(404);
    expect(patch.json().code).toBe('project-not-found');
    expect((await remove(project.id, {name: project.name})).statusCode).toBe(404);
  });

  test('writes PROJECT_DELETED with the actor', async () => {
    const project = await projectFactory.create({workspaceId});

    await remove(project.id, {name: project.name});

    const events = await db()
      .select()
      .from(projectsOutbox)
      .where(sql`${projectsOutbox.payload}->>'projectId' = ${project.id}`);
    expect(events).toEqual([
      expect.objectContaining({
        eventType: 'projects.project.deleted',
        payload: expect.objectContaining({workspaceId, deletedBy: 'user-1'}),
      }),
    ]);
  });

  test('refuses a name that does not match and keeps the project', async () => {
    const project = await projectFactory.create({workspaceId});

    const res = await remove(project.id, {name: 'Something else'});

    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe('project-name-mismatch');
    expect((await get(project.id)).statusCode).toBe(200);
  });

  test('refuses the default project', async () => {
    const project = await projectFactory.create({workspaceId});
    await db().update(projects).set({isDefault: true}).where(eq(projects.id, project.id));

    const res = await remove(project.id, {name: project.name});

    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('default-project-undeletable');
    expect((await get(project.id)).statusCode).toBe(200);
  });

  test('refuses a workspace member who is not an admin', async () => {
    const project = await projectFactory.create({workspaceId});
    memberships = [
      {workspaceId, role: 'member' as UserContextMembership['role'], workspaceStatus: 'active'},
    ];

    const res = await remove(project.id, {name: project.name});

    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('forbidden');
    expect((await get(project.id)).statusCode).toBe(200);
  });

  test('refuses an impersonated session', async () => {
    const project = await projectFactory.create({workspaceId});
    impersonatorId = crypto.randomUUID();

    const res = await remove(project.id, {name: project.name});

    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('impersonation-not-permitted');
    impersonatorId = undefined;
    expect((await get(project.id)).statusCode).toBe(200);
  });

  test('refuses a user outside the workspace of the project', async () => {
    const project = await projectFactory.create({workspaceId: crypto.randomUUID()});

    const res = await remove(project.id, {name: project.name});

    expect(res.statusCode).toBe(403);
  });

  test('rejects a body with no name', async () => {
    const project = await projectFactory.create({workspaceId});

    const res = await remove(project.id, {});

    expect(res.statusCode).toBe(400);
  });
});
