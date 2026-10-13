import {AUTH_USER, buildUserContext, setUserContext} from '@shipfox/api-auth-context';
import {
  type AuthMethod,
  ClientError,
  closeApp,
  createApp,
  extractBearerToken,
  type FastifyInstance,
} from '@shipfox/node-fastify';
import type {LightMyRequestResponse} from 'fastify';
import {type CacheStoragePolicy, createWorkspaceStorageLimits} from '#core/storage-policy.js';
import {createCacheRoutes} from '#presentation/routes/index.js';
import {createCacheManagementRoutes} from '#presentation/routes/management/index.js';
import {fakeLeaseTokenAuthMethod} from './lease-token.js';

export interface TestMembership {
  workspaceId: string;
  /** The role enum has only `admin` today; a test passes another value to cover a future role. */
  role?: string;
  workspaceStatus?: 'active' | 'suspended' | 'deleted';
}

const users = new Map<string, ReturnType<typeof buildUserContext>>();

const fakeUserAuthMethod: AuthMethod = {
  name: AUTH_USER,
  authenticate: (request) => {
    const token = extractBearerToken(request.headers.authorization);
    const context = token ? users.get(token) : undefined;
    if (!context) throw new ClientError('Authentication required', 'unauthorized', {status: 401});
    setUserContext(request, context);
    return Promise.resolve();
  },
};

/** A signed-in member of the given workspaces. Returns the headers that carry its session. */
export function signIn(memberships: TestMembership[]): {authorization: string} {
  const token = `test-user-${crypto.randomUUID()}`;
  users.set(
    token,
    buildUserContext({
      userId: crypto.randomUUID(),
      email: 'member@example.com',
      memberships: memberships.map((membership) => ({
        workspaceId: membership.workspaceId,
        role: (membership.role ?? 'admin') as 'admin',
        workspaceStatus: membership.workspaceStatus ?? 'active',
      })),
    }),
  );
  return {authorization: `Bearer ${token}`};
}

export interface ManagementTestApp {
  app: FastifyInstance;
  /** Which workspace each project belongs to. An unknown project does not exist. */
  projectWorkspaces: Map<string, string>;
  /** Runs started as dev runs, with the user who started each. Any other run is a synced one. */
  devRunUsers: Map<string, string | null>;
  close(): Promise<void>;
}

/** Runner routes seed entries through real uploads. Management routes are what a test calls. */
export async function createManagementTestApp(
  options: {storagePolicy?: CacheStoragePolicy} = {},
): Promise<ManagementTestApp> {
  const projectWorkspaces = new Map<string, string>();
  const devRunUsers = new Map<string, string | null>();
  const limits = createWorkspaceStorageLimits(options.storagePolicy);
  const app = await createApp({
    auth: [fakeLeaseTokenAuthMethod, fakeUserAuthMethod],
    routes: [
      ...createCacheRoutes(
        {
          getWorkflowRunOrigin: ({workflowRunId}) =>
            Promise.resolve(
              devRunUsers.has(workflowRunId)
                ? {origin: 'dev', initiatedByUserId: devRunUsers.get(workflowRunId) ?? null}
                : {origin: 'synced', initiatedByUserId: null},
            ),
        },
        limits,
      ),
      ...createCacheManagementRoutes({projects: fakeProjects(projectWorkspaces), limits}),
    ],
    swagger: false,
  });
  await app.ready();
  return {app, projectWorkspaces, devRunUsers, close: () => closeApp()};
}

export function fakeProjects(projectWorkspaces: Map<string, string>) {
  return {
    getProjectById: ({projectId}: {projectId: string}) => {
      const workspaceId = projectWorkspaces.get(projectId);
      return Promise.resolve({
        project: workspaceId ? ({id: projectId, workspaceId} as never) : null,
      });
    },
  };
}

export function expectJson(response: LightMyRequestResponse, statusCode: number) {
  if (response.statusCode !== statusCode) {
    throw new Error(`Expected ${statusCode}, got ${response.statusCode}: ${response.body}`);
  }
  return response.json();
}
