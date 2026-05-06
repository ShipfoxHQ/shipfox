import {configureApiClient} from '@shipfox/client-api';
import {screen} from '@testing-library/react';
import {jsonResponse, PROJECT_TEST_WID, renderProjectPage} from '#test/pages.js';
import {ProjectDetailPage} from './project-detail-page.js';

describe('ProjectDetailPage', () => {
  test('renders project metadata via section H2s (project name lives in the nav crumb)', async () => {
    configureApiClient({fetchImpl: vi.fn().mockResolvedValue(jsonResponse(projectDto()))});

    renderProjectPage(
      `/workspaces/${PROJECT_TEST_WID}/projects/44444444-4444-4444-8444-444444444444`,
      <ProjectDetailPage projectId="44444444-4444-4444-8444-444444444444" />,
    );

    // Regression: the page no longer renders the project name as an in-page H1
    // (it's in the NavBar breadcrumb in production). Section H2s + body data remain.
    expect(await screen.findByRole('heading', {name: 'Source identity'})).toBeInTheDocument();
    expect(screen.getAllByText('platform')[0]).toBeInTheDocument();
    expect(screen.getByText('Workflow discovery')).toBeInTheDocument();
  });

  test('renders not found state', async () => {
    configureApiClient({
      fetchImpl: vi.fn().mockResolvedValue(jsonResponse({code: 'not-found'}, {status: 404})),
    });

    renderProjectPage(
      `/workspaces/${PROJECT_TEST_WID}/projects/missing`,
      <ProjectDetailPage projectId="missing" />,
    );

    expect(await screen.findByText('This project was not found.')).toBeInTheDocument();
  });
});

function projectDto() {
  return {
    id: '44444444-4444-4444-8444-444444444444',
    workspace_id: '11111111-1111-4111-8111-111111111111',
    name: 'Platform',
    source: {
      connection_id: '33333333-3333-4333-8333-333333333333',
      external_repository_id: 'platform',
    },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}
