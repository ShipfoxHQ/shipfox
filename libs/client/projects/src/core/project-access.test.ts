import {
  type AccessDraft,
  type AccessResource,
  accessDraftFromAccess,
  findEmptyResourceScopes,
  isSameAccess,
  type ProjectAccess,
  type ProjectAccessConfigSource,
  reduceAccessDraft,
  toUpdateProjectAccessCommand,
} from './project-access.js';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const GITHUB_ID = '22222222-2222-4222-8222-222222222222';
const SLACK_ID = '33333333-3333-4333-8333-333333333333';
const MANAGED_ID = '44444444-4444-4444-8444-444444444444';

const linkedSource: ProjectAccessConfigSource = {
  kind: 'linked',
  connectionId: GITHUB_ID,
  externalRepositoryId: 'github:1',
  lookupName: 'acme/config',
};
const managedSource: ProjectAccessConfigSource = {
  kind: 'managed',
  connectionId: MANAGED_ID,
  externalRepositoryId: 'managed:1',
  lookupName: null,
};

function repository(id: number, name: string): AccessResource {
  return {
    kind: 'repository',
    externalId: `github:${id}`,
    lookupName: name.toLowerCase(),
    displayName: name,
  };
}

function access(
  configSource: ProjectAccessConfigSource,
  connections: ProjectAccess['connections'],
): ProjectAccess {
  return {projectId: PROJECT_ID, configSource, connections};
}

describe('accessDraftFromAccess', () => {
  test('starts a project with full access on All connections', () => {
    const result = accessDraftFromAccess(access(managedSource, 'all'));

    expect(result).toEqual({mode: 'all', connections: []});
  });

  test('lists the config connection of a linked project, limited to its config repository', () => {
    const slack = {
      connectionId: SLACK_ID,
      provider: 'slack',
      displayName: 'Acme',
      resources: 'all' as const,
    };

    const result = accessDraftFromAccess(access(linkedSource, [slack]));

    expect(result).toEqual({
      mode: 'selected',
      connections: [
        {connectionId: GITHUB_ID, resources: []},
        {connectionId: SLACK_ID, resources: 'all'},
      ],
    });
  });
});

describe('reduceAccessDraft', () => {
  test('adds the locked config connection when a linked project narrows', () => {
    const draft: AccessDraft = {mode: 'all', connections: []};

    const result = reduceAccessDraft(draft, {type: 'set-mode', mode: 'selected'}, linkedSource);

    expect(result).toEqual({
      mode: 'selected',
      connections: [{connectionId: GITHUB_ID, resources: 'all'}],
    });
  });

  test('keeps the list across a switch to All connections and back', () => {
    const draft: AccessDraft = {
      mode: 'selected',
      connections: [{connectionId: SLACK_ID, resources: 'all'}],
    };

    const all = reduceAccessDraft(draft, {type: 'set-mode', mode: 'all'}, managedSource);
    const result = reduceAccessDraft(all, {type: 'set-mode', mode: 'selected'}, managedSource);

    expect(result).toEqual(draft);
  });

  test('never removes the config connection of a linked project', () => {
    const draft: AccessDraft = {
      mode: 'selected',
      connections: [{connectionId: GITHUB_ID, resources: 'all'}],
    };

    const result = reduceAccessDraft(
      draft,
      {type: 'set-connection', connectionId: GITHUB_ID, listed: false},
      linkedSource,
    );

    expect(result).toBe(draft);
  });

  test('lists a checked connection with all its resources, and drops an unchecked one', () => {
    const draft: AccessDraft = {mode: 'selected', connections: []};

    const listed = reduceAccessDraft(
      draft,
      {type: 'set-connection', connectionId: SLACK_ID, listed: true},
      managedSource,
    );
    const result = reduceAccessDraft(
      listed,
      {type: 'set-connection', connectionId: SLACK_ID, listed: false},
      managedSource,
    );

    expect(listed.connections).toEqual([{connectionId: SLACK_ID, resources: 'all'}]);
    expect(result.connections).toEqual([]);
  });

  test('adds and removes a selected repository', () => {
    const app = repository(2, 'acme/App');
    const draft: AccessDraft = {
      mode: 'selected',
      connections: [{connectionId: GITHUB_ID, resources: 'all'}],
    };

    const selected = reduceAccessDraft(
      draft,
      {type: 'set-resource-scope', connectionId: GITHUB_ID, scope: 'selected'},
      managedSource,
    );
    const added = reduceAccessDraft(
      selected,
      {type: 'set-resource', connectionId: GITHUB_ID, resource: app, listed: true},
      managedSource,
    );
    const result = reduceAccessDraft(
      added,
      {type: 'set-resource', connectionId: GITHUB_ID, resource: app, listed: false},
      managedSource,
    );

    expect(selected.connections[0]?.resources).toEqual([]);
    expect(added.connections[0]?.resources).toEqual([app]);
    expect(result.connections[0]?.resources).toEqual([]);
  });
});

describe('findEmptyResourceScopes', () => {
  test('reports a Selected connection with no repository', () => {
    const draft: AccessDraft = {
      mode: 'selected',
      connections: [{connectionId: GITHUB_ID, resources: []}],
    };

    const result = findEmptyResourceScopes(draft, managedSource);

    expect(result).toEqual([GITHUB_ID]);
  });

  test('accepts the config connection of a linked project alone, since its repository counts', () => {
    const draft: AccessDraft = {
      mode: 'selected',
      connections: [{connectionId: GITHUB_ID, resources: []}],
    };

    const result = findEmptyResourceScopes(draft, linkedSource);

    expect(result).toEqual([]);
  });
});

describe('toUpdateProjectAccessCommand', () => {
  test('resets to All connections', () => {
    const draft: AccessDraft = {
      mode: 'all',
      connections: [{connectionId: SLACK_ID, resources: 'all'}],
    };

    const result = toUpdateProjectAccessCommand(PROJECT_ID, draft);

    expect(result).toEqual({projectId: PROJECT_ID, connections: 'all'});
  });

  test('sends each listed connection and the ids of its repositories', () => {
    const draft: AccessDraft = {
      mode: 'selected',
      connections: [
        {connectionId: GITHUB_ID, resources: [repository(2, 'acme/App')]},
        {connectionId: SLACK_ID, resources: 'all'},
      ],
    };

    const result = toUpdateProjectAccessCommand(PROJECT_ID, draft);

    expect(result).toEqual({
      projectId: PROJECT_ID,
      connections: [
        {connectionId: GITHUB_ID, resources: [{kind: 'repository', externalId: 'github:2'}]},
        {connectionId: SLACK_ID, resources: 'all'},
      ],
    });
  });
});

describe('isSameAccess', () => {
  test('ignores the order of connections and repositories', () => {
    const left: AccessDraft = {
      mode: 'selected',
      connections: [
        {connectionId: GITHUB_ID, resources: [repository(2, 'a/b'), repository(3, 'a/c')]},
        {connectionId: SLACK_ID, resources: 'all'},
      ],
    };
    const right: AccessDraft = {
      mode: 'selected',
      connections: [
        {connectionId: SLACK_ID, resources: 'all'},
        {connectionId: GITHUB_ID, resources: [repository(3, 'a/c'), repository(2, 'a/b')]},
      ],
    };

    const result = isSameAccess(left, right);

    expect(result).toBe(true);
  });

  test('tells a narrowed list from All connections', () => {
    const result = isSameAccess(
      {mode: 'all', connections: []},
      {mode: 'selected', connections: []},
    );

    expect(result).toBe(false);
  });
});
