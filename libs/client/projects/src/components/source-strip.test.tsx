import {configureApiClient} from '@shipfox/client-api';
import {screen, within} from '@testing-library/react';
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
  test('shows the connection name for an active connection', async () => {
    renderSourceStrip({connections: [connectionDto({lifecycleStatus: 'active'})]});

    const strip = await screen.findByRole('region', {name: 'Project source'});

    expect(await within(strip).findByText('Acme GitHub')).toBeInTheDocument();
    expect(within(strip).queryByText('Source unavailable')).not.toBeInTheDocument();
    expect(within(strip).queryByRole('link')).not.toBeInTheDocument();
  });

  test.each([
    ['disabled', 'Disabled'],
    ['error', 'Error'],
  ] as const)('flags a %s connection and links to its page', async (lifecycleStatus, badge) => {
    renderSourceStrip({connections: [connectionDto({lifecycleStatus})]});

    const strip = await screen.findByRole('region', {name: 'Project source'});

    expect(await within(strip).findByText('Source unavailable')).toBeInTheDocument();
    expect(within(strip).getByText(badge)).toBeInTheDocument();
    expect(within(strip).getByRole('link', {name: 'Open connection'})).toHaveAttribute(
      'href',
      `/w/${PROJECT_TEST_WSLUG}/settings/integrations/github_octo`,
    );
  });

  test('flags a missing connection and links to the integrations settings', async () => {
    renderSourceStrip({connections: [connectionDto({id: OTHER_CONNECTION_ID})]});

    const strip = await screen.findByRole('region', {name: 'Project source'});

    expect(await within(strip).findByText('Source unavailable')).toBeInTheDocument();
    expect(within(strip).getByText('Error')).toBeInTheDocument();
    expect(within(strip).getByRole('link', {name: 'Open integrations'})).toHaveAttribute(
      'href',
      `/w/${PROJECT_TEST_WSLUG}/settings/integrations`,
    );
  });
});

function renderSourceStrip({connections}: {connections: ReturnType<typeof connectionDto>[]}) {
  configureApiClient({
    fetchImpl: vi.fn((input: RequestInfo | URL) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.pathname === '/integration-connections') {
        return Promise.resolve(jsonResponse({connections}));
      }
      return Promise.resolve(jsonResponse({code: 'not-found'}, {status: 404}));
    }),
  });

  renderProjectPage(
    `/w/${PROJECT_TEST_WSLUG}`,
    <SourceStrip
      connectionId={CONNECTION_ID}
      externalRepositoryId="123456"
      sync={null}
      isPending={false}
    />,
  );
}

function connectionDto({
  id = CONNECTION_ID,
  lifecycleStatus = 'active',
}: {
  id?: string;
  lifecycleStatus?: 'active' | 'disabled' | 'error';
} = {}) {
  return {
    id,
    workspace_id: PROJECT_TEST_WID,
    provider: 'github',
    external_account_id: 'octo',
    slug: 'github_octo',
    display_name: 'Acme GitHub',
    lifecycle_status: lifecycleStatus,
    capabilities: ['source_control'],
    created_at: '2026-05-07T00:00:00.000Z',
    updated_at: '2026-05-07T00:00:00.000Z',
  };
}
