import {
  defaultCheckoutRepository,
  evaluateConnectionAccess,
  evaluateResourceAccess,
  findProjectAccessViolations,
  isConnectionNarrowed,
  MAX_PROJECT_ACCESS_CONNECTIONS,
  MAX_PROJECT_ACCESS_RESOURCES,
  type ProjectAccessPolicy,
  type ProjectConnectionScope,
  soleListedConnection,
} from './access.js';

const PROJECT_ID = '0190a000-0000-7000-8000-000000000001';
const CONFIG_CONNECTION = '0190a000-0000-7000-8000-0000000000a1';
const GITHUB_ACME = '0190a000-0000-7000-8000-0000000000b1';
const GITHUB_OSS = '0190a000-0000-7000-8000-0000000000b2';
const LINEAR = '0190a000-0000-7000-8000-0000000000c1';
const SLACK = '0190a000-0000-7000-8000-0000000000d1';

const sdk = {kind: 'repository', externalId: 'github:1', lookupName: 'acme-oss/sdk'};
const docs = {kind: 'repository', externalId: 'github:2', lookupName: 'acme-oss/docs'};
const config = {kind: 'repository', externalId: 'github:9', lookupName: 'acme/config'};

function linkedPolicy(connections: ProjectAccessPolicy['connections']): ProjectAccessPolicy {
  return {
    projectId: PROJECT_ID,
    configSource: {
      managed: false,
      connectionId: GITHUB_ACME,
      externalRepositoryId: config.externalId,
      lookupName: config.lookupName,
    },
    connections,
  };
}

function managedPolicy(connections: ProjectAccessPolicy['connections']): ProjectAccessPolicy {
  return {
    projectId: PROJECT_ID,
    configSource: {
      managed: true,
      connectionId: CONFIG_CONNECTION,
      externalRepositoryId: 'managed:project',
      lookupName: null,
    },
    connections,
  };
}

function scope(
  connectionId: string,
  resources: ProjectConnectionScope['resources'],
): ProjectConnectionScope {
  return {connectionId, resources};
}

describe('evaluateConnectionAccess', () => {
  test('allows every connection when the project uses all connections', () => {
    const decision = evaluateConnectionAccess(managedPolicy('all'), {connectionId: SLACK});

    expect(decision).toEqual({allowed: true, resource: null});
  });

  test('allows a listed connection', () => {
    const policy = managedPolicy([scope(LINEAR, 'all')]);

    expect(evaluateConnectionAccess(policy, {connectionId: LINEAR}).allowed).toBe(true);
  });

  test('denies a connection that is not listed', () => {
    const policy = managedPolicy([scope(LINEAR, 'all')]);

    expect(evaluateConnectionAccess(policy, {connectionId: SLACK})).toEqual({
      allowed: false,
      reason: 'connection_not_allowed',
    });
  });

  test('always allows the config source connection', () => {
    const policy = linkedPolicy([scope(LINEAR, 'all')]);

    expect(evaluateConnectionAccess(policy, {connectionId: GITHUB_ACME}).allowed).toBe(true);
  });

  test('denies every connection when a managed project lists none', () => {
    const policy = managedPolicy([]);

    expect(evaluateConnectionAccess(policy, {connectionId: GITHUB_ACME}).allowed).toBe(false);
  });
});

describe('isConnectionNarrowed', () => {
  test('is false when the project uses all connections', () => {
    expect(
      isConnectionNarrowed(linkedPolicy('all'), {
        connectionId: GITHUB_ACME,
        resourceKind: 'repository',
      }),
    ).toBe(false);
  });

  test('is false for a listed connection with all resources', () => {
    const policy = managedPolicy([scope(GITHUB_ACME, 'all')]);

    expect(
      isConnectionNarrowed(policy, {connectionId: GITHUB_ACME, resourceKind: 'repository'}),
    ).toBe(false);
  });

  test('is true for a listed connection with selected resources of the kind', () => {
    const policy = managedPolicy([scope(GITHUB_OSS, [sdk])]);

    expect(
      isConnectionNarrowed(policy, {connectionId: GITHUB_OSS, resourceKind: 'repository'}),
    ).toBe(true);
  });

  test('is false for a kind the selected resources do not hold', () => {
    const policy = managedPolicy([
      scope(LINEAR, [{kind: 'team', externalId: 't1', lookupName: 'a'}]),
    ]);

    expect(isConnectionNarrowed(policy, {connectionId: LINEAR, resourceKind: 'repository'})).toBe(
      false,
    );
  });

  test('limits the unlisted config source connection to its config repository', () => {
    const policy = linkedPolicy([scope(LINEAR, 'all')]);

    expect(
      isConnectionNarrowed(policy, {connectionId: GITHUB_ACME, resourceKind: 'repository'}),
    ).toBe(true);
  });
});

describe('evaluateResourceAccess', () => {
  const externalId = (id: string) => ({
    kind: 'external-id' as const,
    resourceKind: 'repository',
    externalId: id,
  });
  const byName = (lookupName: string) => ({
    kind: 'name' as const,
    resourceKind: 'repository',
    lookupName,
  });

  test('allows every target of a project with all connections and returns no resource', () => {
    const decision = evaluateResourceAccess(managedPolicy('all'), {
      connectionId: GITHUB_OSS,
      target: externalId('github:77'),
    });

    expect(decision).toEqual({allowed: true, resource: null});
  });

  test('allows every target of a listed connection with all resources', () => {
    const policy = managedPolicy([scope(GITHUB_OSS, 'all')]);

    const decision = evaluateResourceAccess(policy, {
      connectionId: GITHUB_OSS,
      target: externalId('github:77'),
    });

    expect(decision).toEqual({allowed: true, resource: null});
  });

  test('denies a connection that is not listed before it looks at the target', () => {
    const policy = managedPolicy([scope(GITHUB_OSS, [sdk])]);

    expect(
      evaluateResourceAccess(policy, {
        connectionId: GITHUB_ACME,
        target: externalId(sdk.externalId),
      }),
    ).toEqual({allowed: false, reason: 'connection_not_allowed'});
  });

  test('allows a selected repository by id and returns the matched resource', () => {
    const policy = managedPolicy([scope(GITHUB_OSS, [sdk, docs])]);

    const decision = evaluateResourceAccess(policy, {
      connectionId: GITHUB_OSS,
      target: externalId(docs.externalId),
    });

    expect(decision).toEqual({
      allowed: true,
      resource: {externalId: docs.externalId, lookupName: docs.lookupName},
    });
  });

  test('allows a selected repository by name, ignoring case, and returns its id', () => {
    const policy = managedPolicy([scope(GITHUB_OSS, [sdk])]);

    const decision = evaluateResourceAccess(policy, {
      connectionId: GITHUB_OSS,
      target: byName('Acme-OSS/SDK'),
    });

    expect(decision).toEqual({
      allowed: true,
      resource: {externalId: sdk.externalId, lookupName: sdk.lookupName},
    });
  });

  test('denies a repository that is not selected', () => {
    const policy = managedPolicy([scope(GITHUB_OSS, [sdk])]);

    expect(
      evaluateResourceAccess(policy, {connectionId: GITHUB_OSS, target: externalId('github:2')}),
    ).toEqual({allowed: false, reason: 'resource_not_allowed'});
  });

  test('does not let a stale name match a repository that reused it', () => {
    const policy = managedPolicy([scope(GITHUB_OSS, [sdk])]);

    const decision = evaluateResourceAccess(policy, {
      connectionId: GITHUB_OSS,
      target: externalId('github:500'),
    });

    expect(decision.allowed).toBe(false);
  });

  test('is ambiguous when two selected resources answer to one name', () => {
    const renamed = {...docs, lookupName: sdk.lookupName};
    const policy = managedPolicy([scope(GITHUB_OSS, [sdk, renamed])]);

    expect(
      evaluateResourceAccess(policy, {connectionId: GITHUB_OSS, target: byName(sdk.lookupName)}),
    ).toEqual({allowed: false, reason: 'resource_ambiguous'});
  });

  test('is not ambiguous when the same resource is both selected and the config repository', () => {
    const policy = linkedPolicy([scope(GITHUB_ACME, [config])]);

    const decision = evaluateResourceAccess(policy, {
      connectionId: GITHUB_ACME,
      target: byName(config.lookupName),
    });

    expect(decision).toEqual({
      allowed: true,
      resource: {externalId: config.externalId, lookupName: config.lookupName},
    });
  });

  test('always allows the config repository of a linked project on a narrowed connection', () => {
    const policy = linkedPolicy([scope(GITHUB_ACME, [sdk])]);

    const decision = evaluateResourceAccess(policy, {
      connectionId: GITHUB_ACME,
      target: externalId(config.externalId),
    });

    expect(decision).toEqual({
      allowed: true,
      resource: {externalId: config.externalId, lookupName: config.lookupName},
    });
  });

  test('allows only the config repository when the project does not list its connection', () => {
    const policy = linkedPolicy([scope(LINEAR, 'all')]);

    expect(
      evaluateResourceAccess(policy, {
        connectionId: GITHUB_ACME,
        target: byName(config.lookupName),
      }).allowed,
    ).toBe(true);
    expect(
      evaluateResourceAccess(policy, {connectionId: GITHUB_ACME, target: externalId('github:3')}),
    ).toEqual({allowed: false, reason: 'resource_not_allowed'});
  });

  test('allows only the config repository with an empty list on the config connection', () => {
    const policy = linkedPolicy([scope(GITHUB_ACME, [])]);

    expect(
      evaluateResourceAccess(policy, {
        connectionId: GITHUB_ACME,
        target: externalId(config.externalId),
      }).allowed,
    ).toBe(true);
    expect(
      evaluateResourceAccess(policy, {connectionId: GITHUB_ACME, target: externalId('github:3')})
        .allowed,
    ).toBe(false);
  });

  test('does not match a config repository id on another connection', () => {
    const policy = linkedPolicy([scope(GITHUB_OSS, [sdk])]);

    expect(
      evaluateResourceAccess(policy, {
        connectionId: GITHUB_OSS,
        target: externalId(config.externalId),
      }).allowed,
    ).toBe(false);
  });

  test('passes a call with no target when the connection passes', () => {
    const policy = managedPolicy([scope(GITHUB_OSS, [sdk])]);

    expect(evaluateResourceAccess(policy, {connectionId: GITHUB_OSS})).toEqual({
      allowed: true,
      resource: null,
    });
    expect(evaluateResourceAccess(policy, {connectionId: GITHUB_OSS, target: null}).allowed).toBe(
      true,
    );
  });

  test('denies a call with no target when the connection does not pass', () => {
    const policy = managedPolicy([scope(GITHUB_OSS, [sdk])]);

    expect(evaluateResourceAccess(policy, {connectionId: LINEAR})).toEqual({
      allowed: false,
      reason: 'connection_not_allowed',
    });
  });

  test('does not apply repository selection to another resource kind', () => {
    const policy = managedPolicy([scope(GITHUB_OSS, [sdk])]);

    const decision = evaluateResourceAccess(policy, {
      connectionId: GITHUB_OSS,
      target: {kind: 'external-id', resourceKind: 'team', externalId: 'team-1'},
    });

    expect(decision).toEqual({allowed: true, resource: null});
  });
});

describe('soleListedConnection', () => {
  const sourceControlConnectionIds = [GITHUB_ACME, GITHUB_OSS];

  test('returns the one listed source-control connection', () => {
    const policy = managedPolicy([scope(GITHUB_OSS, 'all'), scope(LINEAR, 'all')]);

    expect(soleListedConnection(policy, {sourceControlConnectionIds})).toBe(GITHUB_OSS);
  });

  test('returns null when the project lists two source-control connections', () => {
    const policy = managedPolicy([scope(GITHUB_ACME, 'all'), scope(GITHUB_OSS, 'all')]);

    expect(soleListedConnection(policy, {sourceControlConnectionIds})).toBeNull();
  });

  test('returns null when the project lists none, or uses all connections', () => {
    expect(
      soleListedConnection(managedPolicy([scope(LINEAR, 'all')]), {sourceControlConnectionIds}),
    ).toBeNull();
    expect(soleListedConnection(managedPolicy('all'), {sourceControlConnectionIds})).toBeNull();
  });
});

describe('defaultCheckoutRepository', () => {
  const sourceControlConnectionIds = [GITHUB_ACME, GITHUB_OSS];

  test('is the config repository of a linked project', () => {
    expect(defaultCheckoutRepository(linkedPolicy('all'), {sourceControlConnectionIds})).toEqual({
      connectionId: GITHUB_ACME,
      externalRepositoryId: config.externalId,
    });
  });

  test('is the one selected repository of a managed project', () => {
    const policy = managedPolicy([scope(GITHUB_OSS, [sdk])]);

    expect(defaultCheckoutRepository(policy, {sourceControlConnectionIds})).toEqual({
      connectionId: GITHUB_OSS,
      externalRepositoryId: sdk.externalId,
    });
  });

  test('ignores a listed tool connection', () => {
    const policy = managedPolicy([scope(GITHUB_OSS, [sdk]), scope(LINEAR, 'all')]);

    expect(defaultCheckoutRepository(policy, {sourceControlConnectionIds})?.connectionId).toBe(
      GITHUB_OSS,
    );
  });

  test('is none for all repositories, even when the installation has one', () => {
    const policy = managedPolicy([scope(GITHUB_OSS, 'all')]);

    expect(defaultCheckoutRepository(policy, {sourceControlConnectionIds})).toBeNull();
  });

  test('is none for two selected repositories', () => {
    const policy = managedPolicy([scope(GITHUB_OSS, [sdk, docs])]);

    expect(defaultCheckoutRepository(policy, {sourceControlConnectionIds})).toBeNull();
  });

  test('is none for two source-control connections, or all connections', () => {
    expect(
      defaultCheckoutRepository(
        managedPolicy([scope(GITHUB_ACME, [config]), scope(GITHUB_OSS, [sdk])]),
        {
          sourceControlConnectionIds,
        },
      ),
    ).toBeNull();
    expect(
      defaultCheckoutRepository(managedPolicy('all'), {sourceControlConnectionIds}),
    ).toBeNull();
  });
});

describe('findProjectAccessViolations', () => {
  test('accepts all connections', () => {
    expect(findProjectAccessViolations(managedPolicy('all'))).toEqual([]);
  });

  test('refuses a selected scope with no resource', () => {
    const policy = managedPolicy([scope(GITHUB_OSS, [])]);

    expect(findProjectAccessViolations(policy)).toEqual([
      {code: 'empty-resource-scope', connectionId: GITHUB_OSS},
    ]);
  });

  test('counts the config repository of a linked project toward the minimum', () => {
    const policy = linkedPolicy([scope(GITHUB_ACME, [])]);

    expect(findProjectAccessViolations(policy)).toEqual([]);
  });

  test('does not count a config repository for another connection', () => {
    const policy = linkedPolicy([scope(GITHUB_OSS, [])]);

    expect(findProjectAccessViolations(policy)).toEqual([
      {code: 'empty-resource-scope', connectionId: GITHUB_OSS},
    ]);
  });

  test('does not count the managed repository toward the minimum', () => {
    const policy = managedPolicy([scope(CONFIG_CONNECTION, [])]);

    expect(findProjectAccessViolations(policy)).toEqual([
      {code: 'empty-resource-scope', connectionId: CONFIG_CONNECTION},
    ]);
  });

  test('refuses a duplicate connection', () => {
    const policy = managedPolicy([scope(LINEAR, 'all'), scope(LINEAR, 'all')]);

    expect(findProjectAccessViolations(policy)).toEqual([
      {code: 'duplicate-connection', connectionId: LINEAR},
    ]);
  });

  test('refuses more connections than the limit', () => {
    const connections = Array.from({length: MAX_PROJECT_ACCESS_CONNECTIONS + 1}, (_, index) =>
      scope(`0190a000-0000-7000-8000-${String(index).padStart(12, '0')}`, 'all'),
    );

    expect(findProjectAccessViolations(managedPolicy(connections))).toEqual([
      {code: 'too-many-connections', limit: MAX_PROJECT_ACCESS_CONNECTIONS},
    ]);
  });

  test('refuses more resources than the limit across connections', () => {
    const resources = Array.from({length: MAX_PROJECT_ACCESS_RESOURCES}, (_, index) => ({
      kind: 'repository',
      externalId: `github:${index}`,
      lookupName: `acme/repo-${index}`,
    }));
    const policy = managedPolicy([scope(GITHUB_ACME, resources), scope(GITHUB_OSS, [sdk])]);

    expect(findProjectAccessViolations(policy)).toEqual([
      {code: 'too-many-resources', limit: MAX_PROJECT_ACCESS_RESOURCES},
    ]);
  });
});
