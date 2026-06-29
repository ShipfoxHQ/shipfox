import {configureApiClient} from '@shipfox/client-api';
import {fireEvent, screen} from '@testing-library/react';
import {jsonResponse, PROJECT_TEST_WID, renderProjectPage} from '#test/pages.js';
import {ProjectsHubPage} from './projects-hub-page.js';

const NEW_PROJECT_REGEX = /New project/i;
const WORKSPACE_PROJECTS_NEW_HREF = `/workspaces/${PROJECT_TEST_WID}/projects/new`;
const CONNECTION_ID = '33333333-3333-4333-8333-333333333333';

describe('ProjectsHubPage', () => {
  test('renders Projects H2 + New project button + empty state with create CTA', async () => {
    configureApiClient({
      fetchImpl: createHubFetch({
        projects: jsonResponse({projects: [], next_cursor: null}),
      }),
    });

    renderProjectPage(`/workspaces/${PROJECT_TEST_WID}`, <ProjectsHubPage />);

    // The page-level "Projects" title belongs in content because the top nav owns
    // workspace identity.
    expect(await screen.findByRole('heading', {name: 'Projects'})).toBeInTheDocument();
    expect(screen.getByRole('link', {name: NEW_PROJECT_REGEX})).toHaveAttribute(
      'href',
      WORKSPACE_PROJECTS_NEW_HREF,
    );
    expect(await screen.findByText('Create your first project')).toBeInTheDocument();
    expect(
      (screen.getAllByRole('link', {name: 'Create project'})[0] as HTMLAnchorElement).getAttribute(
        'href',
      ),
    ).toBe(WORKSPACE_PROJECTS_NEW_HREF);
  });

  test('renders projects and loads the next cursor page', async () => {
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      const url = new URL(requestInputUrl(input));
      if (url.pathname === '/integration-connections') {
        return Promise.resolve(jsonResponse(connectionsDto()));
      }
      if (url.pathname === '/projects') {
        if (url.searchParams.get('cursor') === 'cursor-1') {
          return Promise.resolve(
            jsonResponse({
              projects: [projectDto({id: 'project-2', name: 'API'})],
              next_cursor: null,
            }),
          );
        }
        return Promise.resolve(
          jsonResponse({
            projects: [projectDto({id: 'project-1', name: 'Platform'})],
            next_cursor: 'cursor-1',
          }),
        );
      }
      return Promise.resolve(jsonResponse({code: 'not-found'}, {status: 404}));
    });
    configureApiClient({fetchImpl});

    renderProjectPage(`/workspaces/${PROJECT_TEST_WID}`, <ProjectsHubPage />);
    expect(await screen.findByText('Platform')).toBeInTheDocument();
    const projectLink = screen.getByText('Platform').closest('a');
    // The card is fully clickable via a stretched link, so the focus ring is
    // drawn on the link's ::after (which covers the whole card), not the link box.
    expect(projectLink).toHaveClass('focus-visible:after:shadow-button-neutral-focus');
    expect(projectLink?.className).not.toContain('shadow-button-secondary');

    fireEvent.click(screen.getByRole('button', {name: 'Load more'}));

    expect(await screen.findByText('API')).toBeInTheDocument();
  });

  test('renders an error alert with retry', async () => {
    configureApiClient({
      fetchImpl: createHubFetch({
        projects: jsonResponse({code: 'server-error'}, {status: 500}),
      }),
    });

    renderProjectPage(`/workspaces/${PROJECT_TEST_WID}`, <ProjectsHubPage />);

    expect(await screen.findByText("Couldn't load projects")).toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Retry loading projects'})).toBeInTheDocument();
  });

  test('shows no status badge or repository id for a connected source', async () => {
    configureApiClient({
      fetchImpl: createHubFetch({
        projects: jsonResponse({
          projects: [
            projectDto({
              id: 'project-1',
              name: 'Platform',
              externalRepositoryId: 'github:octo/platform',
            }),
          ],
          next_cursor: null,
        }),
        connections: jsonResponse(connectionsDto()),
      }),
    });

    renderProjectPage(`/workspaces/${PROJECT_TEST_WID}`, <ProjectsHubPage />);

    expect(await screen.findByText('Platform')).toBeInTheDocument();
    // "Connected" is the expected state, so it stays unbadged; the raw repository
    // id is dropped because it is meaningless to end users.
    expect(screen.queryByText('Connected')).not.toBeInTheDocument();
    expect(screen.queryByText('Disconnected')).not.toBeInTheDocument();
    expect(screen.queryByText('github:octo/platform')).not.toBeInTheDocument();
  });

  test('flags a disconnected source with a reconnect link to integration settings', async () => {
    configureApiClient({
      fetchImpl: createHubFetch({
        projects: jsonResponse({
          projects: [projectDto({id: 'project-1', name: 'Platform'})],
          next_cursor: null,
        }),
        connections: jsonResponse(connectionsDto({lifecycleStatus: 'error'})),
      }),
    });

    renderProjectPage(`/workspaces/${PROJECT_TEST_WID}`, <ProjectsHubPage />);

    expect(await screen.findByText('Disconnected')).toBeInTheDocument();
    const reconnectLink = await screen.findByRole('link', {name: 'Reconnect'});
    expect(reconnectLink).toHaveAttribute(
      'href',
      `/workspaces/${PROJECT_TEST_WID}/settings/integrations`,
    );
  });
});

function createHubFetch({
  projects = jsonResponse({
    projects: [projectDto({id: 'project-1', name: 'Platform'})],
    next_cursor: null,
  }),
  connections = jsonResponse(connectionsDto()),
}: {
  projects?: Response;
  connections?: Response;
} = {}) {
  return vi.fn((input: RequestInfo | URL) => {
    const url = new URL(requestInputUrl(input));
    if (url.pathname === '/integration-connections') {
      return Promise.resolve(connections.clone());
    }
    if (url.pathname === '/projects') {
      return Promise.resolve(projects.clone());
    }
    return Promise.resolve(jsonResponse({code: 'not-found'}, {status: 404}));
  });
}

function requestInputUrl(input: RequestInfo | URL) {
  if (input instanceof Request) return input.url;
  return String(input);
}

function projectDto({
  id,
  name,
  connectionId = CONNECTION_ID,
  externalRepositoryId = 'github:octo/platform',
}: {
  id: string;
  name: string;
  connectionId?: string;
  externalRepositoryId?: string;
}) {
  return {
    id,
    workspace_id: PROJECT_TEST_WID,
    name,
    source: {
      connection_id: connectionId,
      external_repository_id: externalRepositoryId,
    },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function connectionsDto({
  lifecycleStatus = 'active',
  id = CONNECTION_ID,
}: {
  lifecycleStatus?: 'active' | 'disabled' | 'error';
  id?: string;
} = {}) {
  return {
    connections: [
      {
        id,
        workspace_id: PROJECT_TEST_WID,
        provider: 'github',
        external_account_id: 'octo',
        display_name: 'Acme GitHub',
        lifecycle_status: lifecycleStatus,
        capabilities: ['source_control'],
        created_at: '2026-05-07T00:00:00.000Z',
        updated_at: '2026-05-07T00:00:00.000Z',
      },
    ],
  };
}
