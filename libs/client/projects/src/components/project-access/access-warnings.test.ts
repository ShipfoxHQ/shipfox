import type {IntegrationConnection} from '@shipfox/client-integrations';
import type {AccessDraft, ProjectAccessConfigSource} from '#core/project-access.js';
import {accessChangeWarnings} from './access-warnings.js';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const GITHUB_ID = '22222222-2222-4222-8222-222222222222';
const SLACK_ID = '33333333-3333-4333-8333-333333333333';
const MANAGED_ID = '44444444-4444-4444-8444-444444444444';

const managedSource: ProjectAccessConfigSource = {
  kind: 'managed',
  connectionId: MANAGED_ID,
  externalRepositoryId: 'managed:1',
  lookupName: null,
};

function connection(
  id: string,
  provider: string,
  capabilities: IntegrationConnection['capabilities'],
): IntegrationConnection {
  return {
    id,
    workspaceId: '55555555-5555-4555-8555-555555555555',
    provider,
    externalAccountId: id,
    slug: provider,
    displayName: 'Acme',
    lifecycleStatus: 'active',
    capabilities,
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
  };
}

const GITEA_ID = '66666666-6666-4666-8666-666666666666';

const connections = [
  connection(GITHUB_ID, 'github', ['source_control', 'agent_tools']),
  connection(GITEA_ID, 'gitea', ['source_control']),
  connection(SLACK_ID, 'slack', ['interaction', 'agent_tools']),
];

const onlyApp: AccessDraft = {
  mode: 'selected',
  connections: [
    {
      connectionId: GITHUB_ID,
      resources: [
        {
          kind: 'repository',
          externalId: 'github:2',
          lookupName: 'acme/app',
          displayName: 'acme/App',
        },
      ],
    },
  ],
};

function warnings({
  saved,
  draft,
  isDefaultProject = false,
}: {
  saved: AccessDraft;
  draft: AccessDraft;
  isDefaultProject?: boolean;
}) {
  return accessChangeWarnings({
    projectId: PROJECT_ID,
    isDefaultProject,
    configSource: managedSource,
    saved,
    draft,
    connections,
    providerName: (provider) => (provider === 'slack' ? 'Slack' : provider),
  });
}

describe('accessChangeWarnings', () => {
  test('warns when a managed project gains a default checkout', () => {
    const result = warnings({saved: {mode: 'all', connections: []}, draft: onlyApp});

    expect(result).toEqual(["Jobs that don't set checkout will check out acme/App."]);
  });

  test('warns when a managed project loses its default checkout', () => {
    const draft: AccessDraft = {
      mode: 'selected',
      connections: [{connectionId: GITHUB_ID, resources: 'all'}],
    };

    const result = warnings({saved: onlyApp, draft});

    expect(result).toEqual(["Jobs that don't set checkout will stop checking out acme/App."]);
  });

  test('warns when the default checkout moves to another connection', () => {
    const draft: AccessDraft = {
      mode: 'selected',
      connections: [
        {
          connectionId: GITEA_ID,
          resources: [
            {
              kind: 'repository',
              externalId: 'github:2',
              lookupName: 'acme/app',
              displayName: 'acme/app',
            },
          ],
        },
      ],
    };

    const result = warnings({saved: onlyApp, draft});

    expect(result).toEqual([
      "Jobs that don't set checkout will stop checking out acme/App.",
      "Jobs that don't set checkout will check out acme/app.",
    ]);
  });

  test('says nothing when the default checkout stays', () => {
    const result = warnings({saved: onlyApp, draft: onlyApp});

    expect(result).toEqual([]);
  });

  test('warns when the default project stops answering Slack', () => {
    const draft: AccessDraft = {
      mode: 'selected',
      connections: [{connectionId: GITHUB_ID, resources: 'all'}],
    };

    const result = warnings({saved: {mode: 'all', connections: []}, draft, isDefaultProject: true});

    expect(result).toEqual(['Slack requests that no agent claims will get no answer.']);
  });

  test('says nothing about Slack on another project', () => {
    const draft: AccessDraft = {
      mode: 'selected',
      connections: [{connectionId: GITHUB_ID, resources: 'all'}],
    };

    const result = warnings({saved: {mode: 'all', connections: []}, draft});

    expect(result).toEqual([]);
  });
});
