import {configureApiClient} from '@shipfox/client-api';
import type {IntegrationConnection} from '@shipfox/client-integrations';
import type {Meta, StoryObj} from '@storybook/react';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {type ReactNode, useMemo} from 'react';
import type {Project} from '#core/project.js';
import type {ProjectAccess} from '#core/project-access.js';
import {ProjectAccessForm} from './project-access-form.js';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const WORKSPACE_ID = '55555555-5555-4555-8555-555555555555';
const GITHUB_ID = '22222222-2222-4222-8222-222222222222';
const GITHUB_OSS_ID = '66666666-6666-4666-8666-666666666666';
const LINEAR_ID = '77777777-7777-4777-8777-777777777777';
const SLACK_ID = '33333333-3333-4333-8333-333333333333';
const MANAGED_ID = '44444444-4444-4444-8444-444444444444';

function connection(
  id: string,
  provider: string,
  displayName: string,
  capabilities: IntegrationConnection['capabilities'],
): IntegrationConnection {
  return {
    id,
    workspaceId: WORKSPACE_ID,
    provider,
    externalAccountId: id,
    slug: `${provider}-${displayName}`,
    displayName,
    lifecycleStatus: 'active',
    capabilities,
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
  };
}

const connections = [
  connection(GITHUB_ID, 'github', 'acme', ['source_control', 'agent_tools']),
  connection(GITHUB_OSS_ID, 'github', 'acme-oss', ['source_control', 'agent_tools']),
  connection(LINEAR_ID, 'linear', 'Acme', ['agent_tools', 'interaction']),
  connection(SLACK_ID, 'slack', 'Acme', ['agent_tools', 'interaction']),
];

const managedProject: Project = {
  id: PROJECT_ID,
  workspaceId: WORKSPACE_ID,
  name: 'Platform',
  slug: 'platform',
  isDefault: false,
  source: {kind: 'managed', connectionId: MANAGED_ID, externalRepositoryId: 'managed:1'},
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
};

const linkedProject: Project = {
  ...managedProject,
  source: {kind: 'linked', connectionId: GITHUB_ID, externalRepositoryId: 'github:1'},
};

const fullAccess: ProjectAccess = {
  projectId: PROJECT_ID,
  configSource: {
    kind: 'managed',
    connectionId: MANAGED_ID,
    externalRepositoryId: 'managed:1',
    lookupName: null,
  },
  connections: 'all',
};

const narrowedAccess: ProjectAccess = {
  projectId: PROJECT_ID,
  configSource: {
    kind: 'linked',
    connectionId: GITHUB_ID,
    externalRepositoryId: 'github:1',
    lookupName: 'acme/platform',
  },
  connections: [
    {connectionId: GITHUB_ID, provider: 'github', displayName: 'acme', resources: []},
    {
      connectionId: GITHUB_OSS_ID,
      provider: 'github',
      displayName: 'acme-oss',
      resources: [
        {
          kind: 'repository',
          externalId: 'github:11',
          lookupName: 'acme-oss/sdk',
          displayName: 'acme-oss/sdk',
        },
        {
          kind: 'repository',
          externalId: 'github:12',
          lookupName: 'acme-oss/docs',
          displayName: 'acme-oss/docs',
        },
      ],
    },
    {connectionId: LINEAR_ID, provider: 'linear', displayName: 'Acme', resources: 'all'},
  ],
};

function StoryProviders({children}: {children: ReactNode}) {
  configureApiClient({
    baseUrl: 'https://api.example.test',
    fetchImpl: async () =>
      new Response(JSON.stringify({resources: [], next_cursor: null}), {
        headers: {'content-type': 'application/json'},
      }),
  });
  const queryClient = useMemo(
    () => new QueryClient({defaultOptions: {queries: {retry: false}}}),
    [],
  );
  return (
    <QueryClientProvider client={queryClient}>
      <div className="mx-auto flex w-full max-w-[1120px] flex-col gap-region p-panel">
        {children}
      </div>
    </QueryClientProvider>
  );
}

const meta = {
  title: 'Projects/ProjectAccessForm',
  component: ProjectAccessForm,
  args: {project: managedProject, access: fullAccess, connections, readOnly: false},
  decorators: [
    (Story) => (
      <StoryProviders>
        <Story />
      </StoryProviders>
    ),
  ],
} satisfies Meta<typeof ProjectAccessForm>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const States: Story = {
  render: () => (
    <>
      <ProjectAccessForm
        project={linkedProject}
        access={narrowedAccess}
        connections={connections}
      />
      <ProjectAccessForm
        project={linkedProject}
        access={narrowedAccess}
        connections={connections}
        readOnly
      />
    </>
  ),
};
