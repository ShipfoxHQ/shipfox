import {configureApiClient} from '@shipfox/client-api';
import {screen} from '@testing-library/react';
import {
  jsonResponse,
  PROJECT_TEST_WID,
  PROJECT_TEST_WSLUG,
  renderProjectPage,
} from '#test/pages.js';
import {SourceStrip} from './source-strip.js';

const CONNECTION_ID = '33333333-3333-4333-8333-333333333333';
const OTHER_CONNECTION_ID = '44444444-4444-4444-8444-444444444444';

describe('SourceStrip', () => {
  test('shows the connection name when the source connection is active', async () => {
    configureApiClient({fetchImpl: connectionsFetch('active')});

    renderSourceStrip();

    expect(await screen.findByText('Acme GitHub')).toBeInTheDocument();
    expect(screen.queryByText('Source unavailable')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', {name: 'Open connection'})).not.toBeInTheDocument();
  });

  test.each([
    ['disabled', 'Disabled'],
    ['error', 'Error'],
  ] as const)('shows an unavailable source when the connection is %s', async (status, badge) => {
    configureApiClient({fetchImpl: connectionsFetch(status)});

    renderSourceStrip();

    expect(await screen.findByText('Source unavailable')).toBeInTheDocument();
    expect(screen.getByText(badge)).toBeInTheDocument();
    expect(screen.queryByText('Acme GitHub')).not.toBeInTheDocument();
    expect(screen.getByRole('link', {name: 'Open connection'})).toHaveAttribute(
      'href',
      `/w/${PROJECT_TEST_WSLUG}/settings/integrations/github_octo`,
    );
  });

  test('shows an unavailable source when the connection is missing', async () => {
    configureApiClient({fetchImpl: connectionsFetch('active', OTHER_CONNECTION_ID)});

    renderSourceStrip();

    expect(await screen.findByText('Source unavailable')).toBeInTheDocument();
    expect(screen.queryByText('Connected source')).not.toBeInTheDocument();
    expect(screen.getByRole('link', {name: 'Open integrations'})).toHaveAttribute(
      'href',
      `/w/${PROJECT_TEST_WSLUG}/settings/integrations`,
    );
  });
});

function renderSourceStrip() {
  return renderProjectPage(
    `/w/${PROJECT_TEST_WSLUG}`,
    <SourceStrip
      connectionId={CONNECTION_ID}
      externalRepositoryId="github:octo/platform"
      sync={null}
      isPending={false}
    />,
  );
}

function connectionsFetch(
  lifecycleStatus: 'active' | 'disabled' | 'error',
  connectionId = CONNECTION_ID,
) {
  return vi.fn((input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.pathname !== '/integration-connections') {
      return Promise.resolve(jsonResponse({code: 'not-found'}, {status: 404}));
    }
    return Promise.resolve(
      jsonResponse({
        connections: [
          {
            id: connectionId,
            workspace_id: PROJECT_TEST_WID,
            provider: 'github',
            external_account_id: 'octo',
            slug: 'github_octo',
            display_name: 'Acme GitHub',
            lifecycle_status: lifecycleStatus,
            capabilities: ['source_control'],
            created_at: '2026-05-07T00:00:00.000Z',
            updated_at: '2026-05-07T00:00:00.000Z',
          },
        ],
      }),
    );
  });
}
