import {buildUserContext, setUserContext} from '@shipfox/api-auth-context';
import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import type {FastifyInstance} from 'fastify';
import Fastify from 'fastify';
import {serializerCompiler, validatorCompiler} from 'fastify-type-provider-zod';
import type {RegistryRef} from '#core/entities/registry-ref.js';
import {fakePackageRegistry, packageIndex} from '#test/fixtures/registry-index.js';
import {definitionFactory} from '#test/index.js';
import {buildGetPackageUpdatesRoute} from './get-package-updates.js';

const projectAccessState = vi.hoisted(() => ({workspaceId: ''}));

const projects = {
  getProjectById: vi.fn<ProjectsModuleClient['getProjectById']>(({projectId}) =>
    Promise.resolve({
      project: {
        id: projectId,
        workspaceId: projectAccessState.workspaceId,
        sourceConnectionId: crypto.randomUUID(),
        sourceExternalRepositoryId: 'repo',
        sourceDefaultBranch: 'main',
        name: 'Project',
      },
    }),
  ),
  requireProjectForWorkspace: vi.fn(),
} as unknown as ProjectsModuleClient;

const registry = fakePackageRegistry({
  indexes: [
    packageIndex({
      package: 'shipfox/slack-thread-digest',
      kind: 'action',
      versions: [
        ['1.4.2', 'patch'],
        ['1.5.0', 'minor', true],
      ],
    }),
    packageIndex({
      package: 'shipfox/ticket-to-pr',
      kind: 'template',
      versions: [
        ['1.2.0', 'minor'],
        ['2.0.0', 'major'],
      ],
    }),
  ],
  changelogs: {'shipfox/ticket-to-pr@2.0.0': '### Major changes\n\n- Requires a tracker.'},
});

const refs: RegistryRef[] = [
  {
    kind: 'action',
    package: 'shipfox/slack-thread-digest',
    version: '1.4.2',
    steps: ['build.digest'],
  },
  {
    kind: 'template',
    package: 'shipfox/ticket-to-pr',
    version: '1.2.0',
    bindings: {source: 'github'},
    options: {},
  },
];

describe('GET /workspaces/:workspaceId/definitions/:definitionId/package-updates', () => {
  let app: FastifyInstance;
  let workspaceId: string;

  beforeAll(async () => {
    app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.addHook('onRequest', (request, _reply, done) => {
      setUserContext(
        request,
        buildUserContext({
          userId: crypto.randomUUID(),
          email: 'user@example.com',
          memberships: [{workspaceId, role: 'admin', workspaceStatus: 'active'}],
        }),
      );
      done();
    });
    const route = buildGetPackageUpdatesRoute({projects, registry});
    app.get('/workspaces/:workspaceId/definitions/:definitionId/package-updates', route);
    await app.ready();
  });

  beforeEach(() => {
    workspaceId = crypto.randomUUID();
    projectAccessState.workspaceId = workspaceId;
  });

  function get(params: {workspaceId?: string; definitionId: string}) {
    return app.inject({
      method: 'GET',
      url: `/workspaces/${params.workspaceId ?? workspaceId}/definitions/${params.definitionId}/package-updates`,
    });
  }

  test('reports a registry template and an action of one definition', async () => {
    const definition = await definitionFactory.create({
      configPath: '.shipfox/workflows/ticket.yml',
      registryRefs: refs,
    });

    const res = await get({definitionId: definition.id});

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      updates: [
        {
          kind: 'action',
          package: 'shipfox/slack-thread-digest',
          version: '1.4.2',
          latest: '1.5.0',
          behind: true,
          bump: 'minor',
          capability_change: true,
          steps: ['build.digest'],
          changelog: [],
        },
        {
          kind: 'template',
          package: 'shipfox/ticket-to-pr',
          version: '1.2.0',
          latest: '2.0.0',
          behind: true,
          bump: 'major',
          changelog: [{version: '2.0.0', markdown: '### Major changes\n\n- Requires a tracker.'}],
          upgrade_prompt:
            'Use Shipfox to upgrade the ticket-to-pr workflow in `.shipfox/workflows/ticket.yml` to 2.0.0.',
        },
      ],
    });
  });

  test('gives a legacy template header no notice', async () => {
    const definition = await definitionFactory.create({
      registryRefs: [{kind: 'template', legacy: true, id: 'ticket-to-pr', revision: 5}],
    });

    const res = await get({definitionId: definition.id});

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({updates: []});
  });

  test('returns an empty list for a definition that uses no registry package', async () => {
    const definition = await definitionFactory.create();

    const res = await get({definitionId: definition.id});

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({updates: []});
  });

  test('returns 404 for an unknown definition', async () => {
    const res = await get({definitionId: crypto.randomUUID()});

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('not-found');
  });

  test('returns 404 when the definition belongs to another workspace', async () => {
    const definition = await definitionFactory.create({registryRefs: refs});
    projectAccessState.workspaceId = crypto.randomUUID();

    const res = await get({definitionId: definition.id});

    expect(res.statusCode).toBe(404);
  });

  test('returns 403 when the user is not a member of the workspace', async () => {
    const definition = await definitionFactory.create();

    const res = await get({workspaceId: crypto.randomUUID(), definitionId: definition.id});

    expect(res.statusCode).toBe(403);
  });
});
