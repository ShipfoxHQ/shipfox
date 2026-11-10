import {AUTH_USER, buildUserContext, setUserContext} from '@shipfox/api-auth-context';
import {defineFlags} from '@shipfox/feature-flags';
import {type AuthMethod, closeApp, createApp, type FastifyRequest} from '@shipfox/node-fastify';
import type {FeatureFlags} from '@shipfox/node-feature-flags';
import {createTestFeatureFlags} from '@shipfox/node-feature-flags/testing';
import {createFeatureFlagsModule} from './feature-flags.js';

const workspaceId = crypto.randomUUID();
const userId = crypto.randomUUID();

const testFlags = defineFlags({
  'sample-chat': {kind: 'boolean', default: false, client: true, desc: 'Shows the sample chat.'},
  'sample-secret': {kind: 'boolean', default: true, desc: 'A server-only sample flag.'},
});

const fakeUserAuth: AuthMethod = {
  name: AUTH_USER,
  authenticate: (request: FastifyRequest) => {
    setUserContext(
      request,
      buildUserContext({
        userId,
        email: 'user@example.com',
        memberships: [{workspaceId, role: 'admin', workspaceStatus: 'active'}],
      }),
    );
    return Promise.resolve();
  },
};

async function createFlagsApp(featureFlags: FeatureFlags) {
  await closeApp();
  const module = createFeatureFlagsModule({
    featureFlags,
    modules: [{name: 'sample', flags: testFlags}],
  });
  return await createApp({auth: [fakeUserAuth], routes: module.routes ?? [], swagger: false});
}

describe('GET /feature-flags', () => {
  afterEach(async () => {
    await closeApp();
  });

  it('serves only client-visible flags, uncached', async () => {
    const app = await createFlagsApp(createTestFeatureFlags({'sample-chat': true}));

    const res = await app.inject({method: 'GET', url: '/feature-flags'});

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({flags: {'sample-chat': true}});
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('evaluates for the caller and the requested workspace', async () => {
    const subjects: unknown[] = [];
    const featureFlags: FeatureFlags = {
      ...createTestFeatureFlags(),
      boolean: (definition, subject) => {
        subjects.push(subject);
        return Promise.resolve(definition.default);
      },
    };
    const app = await createFlagsApp(featureFlags);

    const res = await app.inject({
      method: 'GET',
      url: `/feature-flags?workspace_id=${workspaceId}`,
    });

    expect(res.statusCode).toBe(200);
    expect(subjects).toEqual([{userId, email: 'user@example.com', workspaceId}]);
  });

  it('refuses a workspace the caller is not a member of', async () => {
    const app = await createFlagsApp(createTestFeatureFlags());

    const res = await app.inject({
      method: 'GET',
      url: `/feature-flags?workspace_id=${crypto.randomUUID()}`,
    });

    expect(res.statusCode).toBe(403);
  });
});
