import {configureApiClient} from '@shipfox/client-api';
import {screen} from '@testing-library/react';
import {jsonResponse, PROJECT_TEST_WID, renderProjectPage} from '#test/pages.js';
import {HomeRouter} from './home-router.js';

function sourceConnection(overrides: {lifecycle_status?: string} = {}) {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    workspace_id: PROJECT_TEST_WID,
    provider: 'github',
    external_account_id: 'acct',
    display_name: 'GitHub',
    lifecycle_status: 'active',
    capabilities: ['source_control'],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function fetchWithConnections(connections: unknown[]) {
  return vi.fn((input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.includes('/integration-connections?')) {
      return Promise.resolve(jsonResponse({connections}));
    }
    if (url.includes('/projects?')) {
      return Promise.resolve(jsonResponse({projects: [], next_cursor: null}));
    }
    return Promise.resolve(jsonResponse({}, {status: 404}));
  });
}

describe('HomeRouter source-connection gating', () => {
  test('a workspace whose only source connection is disabled is sent to onboarding', async () => {
    configureApiClient({
      fetchImpl: fetchWithConnections([sourceConnection({lifecycle_status: 'disabled'})]),
    });

    renderProjectPage('/', <HomeRouter />);

    // The disabled connection is filtered out, so the landing router treats the
    // workspace as having no usable source and routes to the integrations hub.
    expect(await screen.findByText('Integrations gallery placeholder')).toBeInTheDocument();
  });

  test('an active source connection keeps the user in the projects flow', async () => {
    configureApiClient({
      fetchImpl: fetchWithConnections([sourceConnection({lifecycle_status: 'active'})]),
    });

    renderProjectPage('/', <HomeRouter />);

    // With a usable connection and no projects yet, the router moves on to
    // project creation instead of bouncing back to onboarding.
    expect(await screen.findByRole('heading', {name: 'Create project'})).toBeInTheDocument();
    expect(screen.queryByText('Integrations gallery placeholder')).not.toBeInTheDocument();
  });
});
