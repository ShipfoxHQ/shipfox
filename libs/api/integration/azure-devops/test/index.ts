import type {IntegrationConnection} from '@shipfox/api-integration-spi';

export function azureDevOpsConnection(
  overrides: Partial<IntegrationConnection<'azure-devops'>> = {},
): IntegrationConnection<'azure-devops'> {
  return {
    id: crypto.randomUUID(),
    workspaceId: crypto.randomUUID(),
    provider: 'azure-devops',
    externalAccountId: 'contoso',
    slug: 'azure_devops_contoso',
    displayName: 'Azure DevOps contoso',
    lifecycleStatus: 'active',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

/** An in-memory stand-in for the scoped workspace secrets client. */
export function memorySecrets() {
  const store = new Map<string, string>();
  const key = (workspaceId: string, namespace: string, name: string) =>
    `${workspaceId}/${namespace}/${name}`;
  return {
    store,
    getSecret: vi.fn((params: {workspaceId: string; namespace: string; key: string}) =>
      Promise.resolve(store.get(key(params.workspaceId, params.namespace, params.key)) ?? null),
    ),
    setSecrets: vi.fn(
      (params: {workspaceId: string; namespace: string; values: Record<string, string>}) => {
        for (const [name, value] of Object.entries(params.values)) {
          store.set(key(params.workspaceId, params.namespace, name), value);
        }
        return Promise.resolve();
      },
    ),
    deleteSecrets: vi.fn((params: {workspaceId: string; namespace: string}) => {
      const prefix = `${params.workspaceId}/${params.namespace}/`;
      let deleted = 0;
      for (const name of [...store.keys()]) {
        if (name.startsWith(prefix)) {
          store.delete(name);
          deleted += 1;
        }
      }
      return Promise.resolve(deleted);
    }),
  };
}

export const PROJECT_ID = '6ce954b1-ce1f-45d1-b94d-e6bf2464ba2c';
export const REPOSITORY_ID = '5febef5a-833d-4e14-b9c0-14cb638f91e6';
export const COMMIT_SHA = 'a'.repeat(40);

export function pushNotification(overrides: Record<string, unknown> = {}) {
  return {
    id: crypto.randomUUID(),
    eventType: 'git.push',
    resource: {
      refUpdates: [{name: 'refs/heads/main', oldObjectId: 'b'.repeat(40), newObjectId: COMMIT_SHA}],
      repository: {
        id: REPOSITORY_ID,
        name: 'platform',
        project: {id: PROJECT_ID, name: 'Fabrikam'},
        defaultBranch: 'refs/heads/main',
      },
      pushedBy: {uniqueName: 'coen@example.com'},
      ...overrides,
    },
  };
}

export function pullRequestNotification(eventType = 'git.pullrequest.created') {
  return {
    id: crypto.randomUUID(),
    eventType,
    resource: {
      pullRequestId: 42,
      sourceRefName: 'refs/heads/feat/ID-1-x',
      repository: {
        id: REPOSITORY_ID,
        name: 'platform',
        project: {id: PROJECT_ID, name: 'Fabrikam'},
      },
    },
  };
}
