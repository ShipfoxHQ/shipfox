import type {ProjectAccessPolicy} from '@shipfox/api-projects-dto';
import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import {createProjectAccessClient, projectAccessPolicy} from '#test/fixtures/project-access.js';
import {RepositoryAuthorizerConfigurationError} from './errors.js';
import {
  createRepositoryAuthorizationRequestContext,
  createRepositoryAuthorizer,
  RepositoryAuthorizationTargetInvalidError,
  repositoryAuthorizationClientErrorCode,
  repositoryAuthorizationClientErrorCodes,
  resolveConnectionAuthorization,
  resolveRepositoryAuthorization,
} from './repository-authorizer.js';

const mocks = vi.hoisted(() => ({
  loggerError: vi.fn(),
  reportError: vi.fn(() => 'event-id'),
}));

vi.mock('@shipfox/node-error-monitoring', () => ({reportError: mocks.reportError}));
vi.mock('@shipfox/node-opentelemetry', () => ({
  logger: () => ({error: mocks.loggerError}),
}));

const workspaceId = 'workspace-1';
const projectId = '11111111-1111-4111-8111-111111111111';
const connectionId = '22222222-2222-4222-8222-222222222222';
const otherConnectionId = '33333333-3333-4333-8333-333333333333';

type Target =
  | {kind: 'external-id'; externalRepositoryId: string}
  | {kind: 'name'; owner: string; name: string};

function policy(overrides: Partial<ProjectAccessPolicy> = {}): ProjectAccessPolicy {
  return projectAccessPolicy({projectId, ...overrides});
}

/** A project limited to the listed repositories of the connection. */
function narrowedPolicy(
  resources: Array<{externalId: string; lookupName: string}>,
): ProjectAccessPolicy {
  return policy({
    connections: [
      {
        connectionId,
        resources: resources.map((resource) => ({kind: 'repository', ...resource})),
      },
    ],
  });
}

function input(repository: Target) {
  return {
    workspaceId,
    projectId,
    connectionId,
    repository,
    capability: 'checkout' as const,
  };
}

function clientWith(
  policies: ProjectAccessPolicy[] | 'all',
): ProjectsModuleClient & {getProjectAccessPolicy: ReturnType<typeof vi.fn>} {
  const client = createProjectAccessClient(policies);
  const getProjectAccessPolicy = vi.fn(client.getProjectAccessPolicy);
  return {...client, getProjectAccessPolicy} as never;
}

describe('repository authorization', () => {
  beforeEach(() => {
    mocks.loggerError.mockReset();
    mocks.reportError.mockReset();
    mocks.reportError.mockReturnValue('event-id');
  });

  describe('a project that reaches every repository', () => {
    it('passes an external-id target through as given', async () => {
      const projects = clientWith([policy()]);

      await expect(
        resolveRepositoryAuthorization({
          projects,
          ...input({kind: 'external-id', externalRepositoryId: 'github:42'}),
        }),
      ).resolves.toEqual({
        authorized: true,
        repository: {externalRepositoryId: 'github:42'},
        access: 'all',
      });
      expect(projects.getProjectAccessPolicy).toHaveBeenCalledWith({workspaceId, projectId});
    });

    it('passes a name target through as given', async () => {
      await expect(
        resolveRepositoryAuthorization({
          projects: clientWith([policy()]),
          ...input({kind: 'name', owner: 'Shipfox', name: 'Platform'}),
        }),
      ).resolves.toEqual({
        authorized: true,
        repository: {owner: 'Shipfox', name: 'Platform'},
        access: 'all',
      });
    });

    it('passes every target when the project lists the connection with all repositories', async () => {
      await expect(
        resolveRepositoryAuthorization({
          projects: clientWith([policy({connections: [{connectionId, resources: 'all'}]})]),
          ...input({kind: 'name', owner: 'shipfox', name: 'platform'}),
        }),
      ).resolves.toEqual({
        authorized: true,
        repository: {owner: 'shipfox', name: 'platform'},
        access: 'all',
      });
    });
  });

  describe('a project narrowed to some repositories', () => {
    const narrowed = narrowedPolicy([{externalId: 'github:42', lookupName: 'shipfox/platform'}]);

    it('allows a listed external id', async () => {
      await expect(
        resolveRepositoryAuthorization({
          projects: clientWith([narrowed]),
          ...input({kind: 'external-id', externalRepositoryId: 'github:42'}),
        }),
      ).resolves.toEqual({
        authorized: true,
        repository: {externalRepositoryId: 'github:42'},
        access: 'selected',
      });
    });

    it('pins a case-insensitive name target to the matched external id', async () => {
      await expect(
        resolveRepositoryAuthorization({
          projects: clientWith([narrowed]),
          ...input({kind: 'name', owner: 'Shipfox', name: 'Platform'}),
        }),
      ).resolves.toEqual({
        authorized: true,
        repository: {externalRepositoryId: 'github:42'},
        access: 'selected',
      });
    });

    it('denies a repository the project does not list', async () => {
      const projects = clientWith([narrowed]);

      await expect(
        resolveRepositoryAuthorization({
          projects,
          ...input({kind: 'name', owner: 'shipfox', name: 'other'}),
        }),
      ).resolves.toEqual({
        authorized: false,
        reason: 'repository_not_granted',
        access: 'selected',
      });
      await expect(
        resolveRepositoryAuthorization({
          projects,
          ...input({kind: 'external-id', externalRepositoryId: 'github:99'}),
        }),
      ).resolves.toEqual({
        authorized: false,
        reason: 'repository_not_granted',
        access: 'selected',
      });
    });

    it('allows the config repository of a linked project on its own connection', async () => {
      const linked = policy({
        configSource: {
          managed: false,
          connectionId,
          externalRepositoryId: 'github:7',
          lookupName: 'shipfox/config',
        },
        connections: [
          {
            connectionId,
            resources: [
              {kind: 'repository', externalId: 'github:42', lookupName: 'shipfox/platform'},
            ],
          },
        ],
      });

      await expect(
        resolveRepositoryAuthorization({
          projects: clientWith([linked]),
          ...input({kind: 'name', owner: 'shipfox', name: 'config'}),
        }),
      ).resolves.toEqual({
        authorized: true,
        repository: {externalRepositoryId: 'github:7'},
        access: 'selected',
      });
    });

    it('denies a name that two stored repositories answer to', async () => {
      const ambiguous = narrowedPolicy([
        {externalId: 'github:1', lookupName: 'shipfox/platform'},
        {externalId: 'github:2', lookupName: 'shipfox/platform'},
      ]);

      await expect(
        resolveRepositoryAuthorization({
          projects: clientWith([ambiguous]),
          ...input({kind: 'name', owner: 'shipfox', name: 'platform'}),
        }),
      ).resolves.toEqual({
        authorized: false,
        reason: 'repository_ambiguous',
        access: 'selected',
      });
    });
  });

  it('denies a connection the project does not list', async () => {
    const listsOther = policy({connections: [{connectionId: otherConnectionId, resources: 'all'}]});

    await expect(
      resolveRepositoryAuthorization({
        projects: clientWith([listsOther]),
        ...input({kind: 'name', owner: 'shipfox', name: 'platform'}),
      }),
    ).resolves.toEqual({
      authorized: false,
      reason: 'connection_not_allowed',
      access: 'selected',
    });
  });

  it('denies a deleted project as final without logging or reporting', async () => {
    const projects = clientWith([]);

    await expect(
      resolveRepositoryAuthorization({
        projects,
        ...input({kind: 'name', owner: 'shipfox', name: 'platform'}),
      }),
    ).resolves.toEqual({authorized: false, reason: 'project_not_found', access: 'selected'});
    expect(mocks.loggerError).not.toHaveBeenCalled();
    expect(mocks.reportError).not.toHaveBeenCalled();
  });

  it('reports a store failure as unavailable, with a log and a report', async () => {
    // Reports are throttled process-wide, so use a fresh module that has reported nothing.
    vi.resetModules();
    const {resolveRepositoryAuthorization: resolve} = await import('./repository-authorizer.js');
    const projects = {
      getProjectAccessPolicy: vi.fn().mockRejectedValue(new Error('database unavailable')),
    } as unknown as ProjectsModuleClient;

    await expect(
      resolve({projects, ...input({kind: 'name', owner: 'shipfox', name: 'platform'})}),
    ).resolves.toEqual({
      authorized: false,
      reason: 'authorization_store_unavailable',
      access: 'selected',
    });
    expect(mocks.loggerError).toHaveBeenCalledOnce();
    expect(mocks.reportError).toHaveBeenCalledOnce();
  });

  it('rethrows cancellation errors without converting them to a denial', async () => {
    const cancellation = Object.assign(new Error('request aborted'), {name: 'AbortError'});
    const projects = {
      getProjectAccessPolicy: vi.fn().mockRejectedValue(cancellation),
    } as unknown as ProjectsModuleClient;

    await expect(
      resolveRepositoryAuthorization({
        projects,
        ...input({kind: 'name', owner: 'shipfox', name: 'platform'}),
      }),
    ).rejects.toBe(cancellation);
  });

  it('rate-limits store failure reports while allowing retries', async () => {
    vi.useFakeTimers({now: new Date('2026-08-31T00:00:00.000Z')});
    vi.resetModules();
    try {
      const {resolveRepositoryAuthorization: resolve} = await import('./repository-authorizer.js');
      vi.advanceTimersByTime(60_001);
      const projects = {
        getProjectAccessPolicy: vi.fn().mockRejectedValue(new Error('database unavailable')),
      } as unknown as ProjectsModuleClient;
      const attempt = input({kind: 'name', owner: 'shipfox', name: 'platform'});

      await resolve({projects, ...attempt});
      await resolve({projects, ...attempt});
      expect(mocks.reportError).toHaveBeenCalledOnce();

      vi.advanceTimersByTime(60_000);
      await resolve({projects, ...attempt});
      expect(mocks.reportError).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  describe('request memo', () => {
    it('loads the policy once for every target one request names', async () => {
      const projects = clientWith([narrowedPolicy([{externalId: 'github:42', lookupName: 'a/b'}])]);
      const request = createRepositoryAuthorizationRequestContext();

      await resolveRepositoryAuthorization({
        projects,
        request,
        ...input({kind: 'name', owner: 'a', name: 'b'}),
      });
      await resolveRepositoryAuthorization({
        projects,
        request,
        ...input({kind: 'name', owner: 'a', name: 'c'}),
      });
      await resolveConnectionAuthorization({
        projects,
        request,
        workspaceId,
        projectId,
        connectionId,
      });

      expect(projects.getProjectAccessPolicy).toHaveBeenCalledOnce();
    });

    it('deduplicates concurrent loads within one request', async () => {
      const projects = clientWith([policy()]);
      const request = createRepositoryAuthorizationRequestContext();

      await Promise.all([
        resolveRepositoryAuthorization({
          projects,
          request,
          ...input({kind: 'name', owner: 'a', name: 'b'}),
        }),
        resolveRepositoryAuthorization({
          projects,
          request,
          ...input({kind: 'name', owner: 'a', name: 'c'}),
        }),
      ]);

      expect(projects.getProjectAccessPolicy).toHaveBeenCalledOnce();
    });

    it('does not memoize a store failure', async () => {
      const getProjectAccessPolicy = vi
        .fn()
        .mockRejectedValueOnce(new Error('database unavailable'))
        .mockResolvedValue({policy: policy()});
      const projects = {getProjectAccessPolicy} as unknown as ProjectsModuleClient;
      const request = createRepositoryAuthorizationRequestContext();
      const attempt = {request, ...input({kind: 'name', owner: 'a', name: 'b'} as const)};

      await expect(resolveRepositoryAuthorization({projects, ...attempt})).resolves.toMatchObject({
        authorized: false,
        reason: 'authorization_store_unavailable',
      });
      await expect(resolveRepositoryAuthorization({projects, ...attempt})).resolves.toMatchObject({
        authorized: true,
      });
      expect(getProjectAccessPolicy).toHaveBeenCalledTimes(2);
    });

    it('memoizes a deleted project within the request', async () => {
      const projects = clientWith([]);
      const request = createRepositoryAuthorizationRequestContext();
      const attempt = {request, ...input({kind: 'name', owner: 'a', name: 'b'} as const)};

      await resolveRepositoryAuthorization({projects, ...attempt});
      await resolveRepositoryAuthorization({projects, ...attempt});

      expect(projects.getProjectAccessPolicy).toHaveBeenCalledOnce();
    });

    it('does not share policies between request contexts', async () => {
      const projects = clientWith([policy()]);
      const attempt = input({kind: 'name', owner: 'a', name: 'b'});

      await resolveRepositoryAuthorization({
        projects,
        request: createRepositoryAuthorizationRequestContext(),
        ...attempt,
      });
      await resolveRepositoryAuthorization({
        projects,
        request: createRepositoryAuthorizationRequestContext(),
        ...attempt,
      });

      expect(projects.getProjectAccessPolicy).toHaveBeenCalledTimes(2);
    });
  });

  describe('invalid targets', () => {
    it.each([
      {kind: 'external-id', externalRepositoryId: 'no-namespace'},
      {kind: 'external-id', externalRepositoryId: 'github:'},
      {kind: 'external-id', externalRepositoryId: 'github:with\nnewline'},
      {kind: 'external-id', externalRepositoryId: 42},
      {kind: 'name', owner: '../escape', name: 'platform'},
      {kind: 'name', owner: 'shipfox', name: 'a/b'},
      {kind: 'other'},
      null,
    ])('rejects %j without consulting Projects', async (repository) => {
      const projects = clientWith([policy()]);

      await expect(
        resolveRepositoryAuthorization({projects, ...input(repository as never)}),
      ).rejects.toBeInstanceOf(RepositoryAuthorizationTargetInvalidError);
      expect(projects.getProjectAccessPolicy).not.toHaveBeenCalled();
    });
  });

  describe('resolveConnectionAuthorization', () => {
    const connectionInput = {workspaceId, projectId, connectionId};

    it('allows a project with full access and reports no narrowing', async () => {
      await expect(
        resolveConnectionAuthorization({projects: clientWith([policy()]), ...connectionInput}),
      ).resolves.toEqual({authorized: true, repositoriesNarrowed: false});
    });

    it('reports a connection limited to some repositories as narrowed', async () => {
      await expect(
        resolveConnectionAuthorization({
          projects: clientWith([narrowedPolicy([{externalId: 'github:1', lookupName: 'a/b'}])]),
          ...connectionInput,
        }),
      ).resolves.toEqual({authorized: true, repositoriesNarrowed: true});
    });

    it('does not report a connection listed with all repositories as narrowed', async () => {
      await expect(
        resolveConnectionAuthorization({
          projects: clientWith([policy({connections: [{connectionId, resources: 'all'}]})]),
          ...connectionInput,
        }),
      ).resolves.toEqual({authorized: true, repositoriesNarrowed: false});
    });

    it('denies a connection the project does not list', async () => {
      await expect(
        resolveConnectionAuthorization({
          projects: clientWith([
            policy({connections: [{connectionId: otherConnectionId, resources: 'all'}]}),
          ]),
          ...connectionInput,
        }),
      ).resolves.toEqual({authorized: false, reason: 'connection_not_allowed'});
    });

    it('denies a deleted project', async () => {
      await expect(
        resolveConnectionAuthorization({projects: clientWith([]), ...connectionInput}),
      ).resolves.toEqual({authorized: false, reason: 'project_not_found'});
    });

    it('reports a store failure as unavailable', async () => {
      const projects = {
        getProjectAccessPolicy: vi.fn().mockRejectedValue(new Error('database unavailable')),
      } as unknown as ProjectsModuleClient;

      await expect(resolveConnectionAuthorization({projects, ...connectionInput})).resolves.toEqual(
        {authorized: false, reason: 'authorization_store_unavailable'},
      );
    });
  });

  describe('createRepositoryAuthorizer', () => {
    it('does not allow a disabled gate to invoke the Projects client', async () => {
      const projects = clientWith([policy()]);
      const authorizer = createRepositoryAuthorizer({projects, enabled: false});

      expect(authorizer.enabled).toBe(false);
      await expect(
        authorizer.resolveRepositoryAuthorization(
          input({kind: 'name', owner: 'shipfox', name: 'platform'}),
        ),
      ).resolves.toBeUndefined();
      await expect(
        authorizer.resolveConnectionAuthorization({workspaceId, projectId, connectionId}),
      ).resolves.toBeUndefined();
      expect(projects.getProjectAccessPolicy).not.toHaveBeenCalled();
    });

    it('rejects an enabled gate without a Projects client', () => {
      expect(() => createRepositoryAuthorizer({enabled: true})).toThrow(
        RepositoryAuthorizerConfigurationError,
      );
    });

    it('decides against the project when enabled', async () => {
      const authorizer = createRepositoryAuthorizer({
        projects: clientWith([policy()]),
        enabled: true,
      });

      expect(authorizer.enabled).toBe(true);
      await expect(
        authorizer.resolveRepositoryAuthorization(
          input({kind: 'name', owner: 'shipfox', name: 'platform'}),
        ),
      ).resolves.toEqual({
        authorized: true,
        repository: {owner: 'shipfox', name: 'platform'},
        access: 'all',
      });
    });

    it('applies an access change on the very next call', async () => {
      let current = narrowedPolicy([{externalId: 'github:42', lookupName: 'shipfox/platform'}]);
      const projects = {
        getProjectAccessPolicy: vi.fn(() => Promise.resolve({policy: current})),
      } as unknown as ProjectsModuleClient;
      const authorizer = createRepositoryAuthorizer({projects, enabled: true});
      const target = input({kind: 'external-id', externalRepositoryId: 'github:42'});

      await expect(authorizer.resolveRepositoryAuthorization(target)).resolves.toMatchObject({
        authorized: true,
      });
      current = narrowedPolicy([{externalId: 'github:7', lookupName: 'shipfox/other'}]);
      await expect(authorizer.resolveRepositoryAuthorization(target)).resolves.toMatchObject({
        authorized: false,
        reason: 'repository_not_granted',
      });
      expect(projects.getProjectAccessPolicy).toHaveBeenCalledTimes(2);
    });
  });

  it('publishes closed client error codes for each denial reason', () => {
    expect(repositoryAuthorizationClientErrorCodes).toEqual({
      repository_required: 'repository-required',
      repository_not_granted: 'repository-not-granted',
      repository_ambiguous: 'repository-ambiguous',
      connection_not_allowed: 'connection-not-allowed',
      project_not_found: 'project-not-found',
      authorization_store_unavailable: 'repository-authorization-unavailable',
    });
    expect(repositoryAuthorizationClientErrorCode('repository_ambiguous')).toBe(
      'repository-ambiguous',
    );
  });
});
