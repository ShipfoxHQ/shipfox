import {configureApiClient} from '@shipfox/client-api';
import {fireEvent, screen} from '@testing-library/react';
import {jsonResponse, PROJECT_TEST_WID, renderProjectPage} from '#test/pages.js';
import {HomeRouter} from './home-router.js';
import {ProjectsHubPage} from './projects-hub-page.js';

const NEW_PROJECT_REGEX = /New project/i;
const WORKSPACE_PROJECTS_NEW_HREF = `/workspaces/${PROJECT_TEST_WID}/projects/new`;

describe('ProjectsHubPage', () => {
  test('routes a workspace with no source connections to integrations', async () => {
    configureApiClient({
      fetchImpl: vi.fn((input: RequestInfo | URL) => {
        const url = input instanceof Request ? input.url : String(input);
        if (url.includes('/integration-connections?')) {
          return Promise.resolve(jsonResponse({connections: []}));
        }
        if (url.includes('/projects?')) {
          return Promise.resolve(jsonResponse({projects: [], next_cursor: null}));
        }

        return Promise.resolve(
          jsonResponse({code: 'not-found', message: 'Not found'}, {status: 404}),
        );
      }),
    });

    renderProjectPage(`/workspaces/${PROJECT_TEST_WID}`, <HomeRouter />);

    expect(await screen.findByText('Integrations gallery placeholder')).toBeInTheDocument();
  });

  test('renders Projects H2 + New project button + empty state with create CTA', async () => {
    configureApiClient({
      fetchImpl: vi.fn().mockResolvedValue(jsonResponse({projects: [], next_cursor: null})),
    });

    renderProjectPage(`/workspaces/${PROJECT_TEST_WID}`, <ProjectsHubPage />);

    // Regression: the page-level "Projects" title is now an in-content H2 (the
    // top nav owns identity); the old workspace-name/email subtitle is gone.
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
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          projects: [projectDto({id: 'project-1', name: 'Platform'})],
          next_cursor: 'cursor-1',
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          projects: [projectDto({id: 'project-2', name: 'API'})],
          next_cursor: null,
        }),
      );
    configureApiClient({fetchImpl});

    renderProjectPage(`/workspaces/${PROJECT_TEST_WID}`, <ProjectsHubPage />);
    expect(await screen.findByText('Platform')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', {name: 'Load more'}));

    expect(await screen.findByText('API')).toBeInTheDocument();
    const secondRequest = fetchImpl.mock.calls[1]?.[0] as Request;
    expect(secondRequest.url).toContain('cursor=cursor-1');
  });

  test('renders an error alert with retry', async () => {
    configureApiClient({
      fetchImpl: vi.fn().mockResolvedValue(jsonResponse({code: 'server-error'}, {status: 500})),
    });

    renderProjectPage(`/workspaces/${PROJECT_TEST_WID}`, <ProjectsHubPage />);

    expect(await screen.findByText('Project request failed')).toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Retry'})).toBeInTheDocument();
  });
});

function projectDto({id, name}: {id: string; name: string}) {
  return {
    id,
    workspace_id: '11111111-1111-4111-8111-111111111111',
    name,
    source: {
      connection_id: '33333333-3333-4333-8333-333333333333',
      external_repository_id: name.toLowerCase(),
    },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}
