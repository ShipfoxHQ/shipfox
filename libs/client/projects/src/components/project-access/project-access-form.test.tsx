import {configureApiClient} from '@shipfox/client-api';
import type {IntegrationConnection} from '@shipfox/client-integrations';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import type {Project} from '#core/project.js';
import type {ProjectAccess} from '#core/project-access.js';
import {jsonResponse} from '#test/pages.js';
import {ProjectAccessForm} from './project-access-form.js';

const ONLY_THESE_CONNECTIONS_RE = /Only these connections/u;
const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const WORKSPACE_ID = '55555555-5555-4555-8555-555555555555';
const GITHUB_ID = '22222222-2222-4222-8222-222222222222';
const SLACK_ID = '33333333-3333-4333-8333-333333333333';
const MANAGED_ID = '44444444-4444-4444-8444-444444444444';

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: PROJECT_ID,
    workspaceId: WORKSPACE_ID,
    name: 'Platform',
    slug: 'platform',
    isDefault: false,
    source: {kind: 'managed', connectionId: MANAGED_ID, externalRepositoryId: 'managed:1'},
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    ...overrides,
  };
}

function connection(
  id: string,
  provider: string,
  capabilities: IntegrationConnection['capabilities'],
): IntegrationConnection {
  return {
    id,
    workspaceId: WORKSPACE_ID,
    provider,
    externalAccountId: id,
    slug: provider,
    displayName: 'acme',
    lifecycleStatus: 'active',
    capabilities,
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
  };
}

const connections = [
  connection(GITHUB_ID, 'github', ['source_control', 'agent_tools']),
  connection(SLACK_ID, 'slack', ['interaction']),
];

const erroredSlack: IntegrationConnection = {
  ...connection(SLACK_ID, 'slack', ['interaction']),
  lifecycleStatus: 'error',
};

const managedAccess: ProjectAccess = {
  projectId: PROJECT_ID,
  configSource: {
    kind: 'managed',
    connectionId: MANAGED_ID,
    externalRepositoryId: 'managed:1',
    lookupName: null,
  },
  connections: 'all',
};

function accessDto(connectionsDto: unknown) {
  return {
    project_id: PROJECT_ID,
    config_source: {
      kind: 'managed',
      connection_id: MANAGED_ID,
      external_repository_id: 'managed:1',
      lookup_name: null,
    },
    connections: connectionsDto,
  };
}

function renderForm(props: {project?: Project; access?: ProjectAccess}) {
  const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}});
  return render(
    <QueryClientProvider client={queryClient}>
      <ProjectAccessForm
        project={props.project ?? project()}
        access={props.access ?? managedAccess}
        connections={connections}
      />
    </QueryClientProvider>,
  );
}

describe('ProjectAccessForm', () => {
  test('locks the config connection and repository of a linked project', () => {
    renderForm({
      project: project({
        source: {kind: 'linked', connectionId: GITHUB_ID, externalRepositoryId: 'github:1'},
      }),
      access: {
        projectId: PROJECT_ID,
        configSource: {
          kind: 'linked',
          connectionId: GITHUB_ID,
          externalRepositoryId: 'github:1',
          lookupName: 'acme/config',
        },
        connections: [],
      },
    });

    const github = screen.getByRole('checkbox', {name: 'GitHub, acme'});
    expect(github).toBeChecked();
    expect(github).toBeDisabled();
    const selected = screen.getByRole('list', {name: 'Selected repositories on GitHub, acme'});
    expect(within(selected).getByText('acme/config')).toBeVisible();
    expect(within(selected).getByText('Config repository')).toBeVisible();
    expect(screen.getByRole('checkbox', {name: 'Slack, acme'})).not.toBeChecked();
  });

  test('hides an inactive connection the project does not list', () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ProjectAccessForm
          project={project()}
          access={{...managedAccess, connections: []}}
          connections={[connections[0] as IntegrationConnection, erroredSlack]}
        />
      </QueryClientProvider>,
    );

    expect(screen.getByRole('checkbox', {name: 'GitHub, acme'})).toBeVisible();
    expect(screen.queryByRole('checkbox', {name: 'Slack, acme'})).not.toBeInTheDocument();
  });

  test('keeps a checked connection removable after it turns inactive', () => {
    const queryClient = new QueryClient();
    const access: ProjectAccess = {...managedAccess, connections: []};
    const form = (workspaceConnections: IntegrationConnection[]) => (
      <QueryClientProvider client={queryClient}>
        <ProjectAccessForm project={project()} access={access} connections={workspaceConnections} />
      </QueryClientProvider>
    );
    const {rerender} = render(form(connections));
    fireEvent.click(screen.getByRole('checkbox', {name: 'Slack, acme'}));

    rerender(form([connections[0] as IntegrationConnection, erroredSlack]));

    const slack = screen.getByRole('checkbox', {name: 'Slack, acme'});
    expect(slack).toBeChecked();
    expect(slack).toBeEnabled();
  });

  test('says that access limits workloads, not who sees the project', () => {
    renderForm({});

    expect(
      screen.getByText(
        "Access limits what this project's workflows and agents can use. It doesn't limit which members can see the project.",
      ),
    ).toBeVisible();
  });

  test('confirms before the default project stops answering Slack, then saves', async () => {
    let putBody: unknown;
    configureApiClient({
      baseUrl: 'https://api.example.test',
      fetchImpl: vi.fn(async (input: RequestInfo | URL) => {
        const request = input as Request;
        putBody = await request.clone().json();
        return jsonResponse(accessDto([{...githubAllDto}]));
      }),
    });
    renderForm({project: project({isDefault: true})});

    fireEvent.click(screen.getByRole('radio', {name: ONLY_THESE_CONNECTIONS_RE}));
    fireEvent.click(screen.getByRole('checkbox', {name: 'GitHub, acme'}));
    fireEvent.click(screen.getByRole('button', {name: 'Save changes'}));
    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByText('Slack requests that no agent claims will get no answer.'),
    ).toBeVisible();
    fireEvent.click(within(dialog).getByRole('button', {name: 'Save access'}));

    await waitFor(() =>
      expect(putBody).toEqual({connections: [{connection_id: GITHUB_ID, resources: 'all'}]}),
    );
  });

  test('asks for a repository before saving an empty Selected list', () => {
    const fetchImpl = vi.fn();
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});
    renderForm({
      access: {
        ...managedAccess,
        connections: [
          {connectionId: GITHUB_ID, provider: 'github', displayName: 'acme', resources: []},
        ],
      },
    });

    fireEvent.click(screen.getByRole('checkbox', {name: 'Slack, acme'}));
    fireEvent.click(screen.getByRole('button', {name: 'Save changes'}));

    expect(screen.getByRole('alert')).toHaveTextContent('Select at least one repository.');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('turns read-only when the API refuses the save', async () => {
    configureApiClient({
      baseUrl: 'https://api.example.test',
      fetchImpl: vi.fn(async () =>
        jsonResponse({code: 'forbidden', message: 'Workspace admin role required'}, {status: 403}),
      ),
    });
    renderForm({});

    fireEvent.click(screen.getByRole('radio', {name: ONLY_THESE_CONNECTIONS_RE}));
    fireEvent.click(screen.getByRole('button', {name: 'Save changes'}));

    expect(
      await screen.findByText("Only workspace admins can change this project's access."),
    ).toBeVisible();
    expect(screen.queryByRole('button', {name: 'Save changes'})).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', {name: 'GitHub, acme'})).toBeDisabled();
  });
});

const githubAllDto = {
  connection_id: GITHUB_ID,
  provider: 'github',
  display_name: 'acme',
  resources: 'all',
};
