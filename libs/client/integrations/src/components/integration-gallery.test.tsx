// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {configureApiClient} from '@shipfox/client-api';
import {screen, within} from '@testing-library/react';
import {INTEGRATIONS_TEST_WID, jsonResponse, renderIntegrationsPage} from '#test/render.js';
import {IntegrationGallery} from './integration-gallery.js';

const SETUP_ROUTES = [
  '/workspaces/$wid/integrations/github',
  '/workspaces/$wid/integrations/sentry',
  '/workspaces/$wid/integrations/debug',
];

const defaultProviders = [
  {provider: 'github', display_name: 'GitHub', capabilities: ['source_control']},
  {provider: 'sentry', display_name: 'Sentry', capabilities: []},
];

const githubConnection = {
  id: '44444444-4444-4444-8444-444444444444',
  workspace_id: INTEGRATIONS_TEST_WID,
  provider: 'github',
  external_account_id: 'installation-1',
  display_name: 'acme-corp',
  lifecycle_status: 'active',
  capabilities: ['source_control'],
  external_url: 'https://github.com/organizations/acme-corp/settings/installations/1',
  created_at: '2026-03-12T00:00:00.000Z',
  updated_at: '2026-03-12T00:00:00.000Z',
};

interface FetchOptions {
  providers?: unknown[];
  connections?: unknown[];
  providersFail?: boolean;
  connectionsFail?: boolean;
}

function fetchForGallery(options: FetchOptions = {}) {
  const {
    providers = defaultProviders,
    connections = [],
    providersFail = false,
    connectionsFail = false,
  } = options;
  return vi.fn((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.includes('/integration-providers')) {
      if (providersFail)
        return Promise.resolve(jsonResponse({code: 'server-error'}, {status: 500}));
      return Promise.resolve(jsonResponse({providers}));
    }
    if (url.includes('/integration-connections')) {
      if (connectionsFail)
        return Promise.resolve(jsonResponse({code: 'server-error'}, {status: 500}));
      return Promise.resolve(jsonResponse({connections}));
    }
    return Promise.resolve(jsonResponse({}, {status: 404}));
  });
}

function renderGallery(
  props: Parameters<typeof IntegrationGallery>[0] = {},
  options: FetchOptions = {},
) {
  configureApiClient({
    baseUrl: 'https://api.example.test',
    fetchImpl: fetchForGallery(options),
  });
  return renderIntegrationsPage({
    path: `/workspaces/${INTEGRATIONS_TEST_WID}/integrations`,
    routePath: '/workspaces/$wid/integrations',
    element: <IntegrationGallery {...props} />,
    extraRoutes: SETUP_ROUTES,
  });
}

const installedRegion = () => screen.getByRole('region', {name: 'Installed integrations'});
const availableRegion = () => screen.getByRole('region', {name: 'Available integrations'});

const SORTED_NAMES_RE = /acme-(early|late)/;
// The meta line carries the date only — the provider is named once, by the
// icon and the account name, never repeated as body text in the row.
const ADDED_META_RE = /^Added /;

describe('IntegrationGallery — installed section', () => {
  test('renders two distinct cards for two connections sharing one provider', async () => {
    renderGallery(
      {},
      {
        connections: [
          {
            ...githubConnection,
            id: '11111111-1111-4111-8111-aaaaaaaaaaaa',
            display_name: 'acme-one',
          },
          {
            ...githubConnection,
            id: '22222222-2222-4222-8222-bbbbbbbbbbbb',
            display_name: 'acme-two',
          },
        ],
      },
    );

    expect(await screen.findByText('acme-one')).toBeVisible();
    expect(screen.getByText('acme-two')).toBeVisible();
    expect(screen.getByText('Provider accounts linked to this workspace.')).toBeVisible();
  });

  test('sorts stably by provider name then created_at regardless of input order', async () => {
    renderGallery(
      {},
      {
        connections: [
          {
            ...githubConnection,
            id: '22222222-2222-4222-8222-bbbbbbbbbbbb',
            display_name: 'acme-late',
            created_at: '2026-05-01T00:00:00.000Z',
          },
          {
            ...githubConnection,
            id: '11111111-1111-4111-8111-aaaaaaaaaaaa',
            display_name: 'acme-early',
            created_at: '2026-01-01T00:00:00.000Z',
          },
        ],
      },
    );

    await screen.findByText('acme-early');
    const names = within(installedRegion())
      .getAllByText(SORTED_NAMES_RE)
      .map((element) => element.textContent);

    expect(names).toEqual(['acme-early', 'acme-late']);
  });

  test('renders lifecycle badges only for states that need attention', async () => {
    renderGallery(
      {},
      {
        connections: [
          {
            ...githubConnection,
            id: '11111111-1111-4111-8111-aaaaaaaaaaaa',
            lifecycle_status: 'active',
          },
          {
            ...githubConnection,
            id: '22222222-2222-4222-8222-bbbbbbbbbbbb',
            display_name: 'acme-disabled',
            lifecycle_status: 'disabled',
          },
          {
            ...githubConnection,
            id: '33333333-3333-4333-8333-cccccccccccc',
            display_name: 'acme-error',
            lifecycle_status: 'error',
          },
        ],
      },
    );

    expect(await screen.findByText('acme-corp')).toBeVisible();
    expect(screen.queryByText('Connected')).not.toBeInTheDocument();
    expect(screen.getByText('Disabled')).toBeVisible();
    expect(screen.getByText('Error')).toBeVisible();
  });

  test('mutes the title of a disabled connection', async () => {
    renderGallery({}, {connections: [{...githubConnection, lifecycle_status: 'disabled'}]});

    const title = await screen.findByText('acme-corp');

    expect(title).toHaveClass('text-foreground-neutral-disabled');
  });

  test('shows the external link only when external_url is set, with the account name in its label', async () => {
    renderGallery(
      {},
      {
        connections: [
          {
            ...githubConnection,
            id: '11111111-1111-4111-8111-aaaaaaaaaaaa',
            display_name: 'acme-linked',
          },
          {
            ...githubConnection,
            id: '22222222-2222-4222-8222-bbbbbbbbbbbb',
            display_name: 'acme-unlinked',
            external_url: undefined,
          },
        ],
      },
    );

    expect(await screen.findByRole('link', {name: 'Open acme-linked in GitHub'})).toHaveAttribute(
      'href',
      githubConnection.external_url,
    );
    expect(
      screen.queryByRole('link', {name: 'Open acme-unlinked in GitHub'}),
    ).not.toBeInTheDocument();
  });

  test('filters connections by capability in memory', async () => {
    renderGallery(
      {capability: 'source_control'},
      {
        connections: [
          githubConnection,
          {
            ...githubConnection,
            id: '22222222-2222-4222-8222-bbbbbbbbbbbb',
            provider: 'sentry',
            display_name: 'sentry-org',
            capabilities: [],
          },
        ],
      },
    );

    expect(await screen.findByText('acme-corp')).toBeVisible();
    expect(screen.queryByText('sentry-org')).not.toBeInTheDocument();
  });

  test('renders a connection whose provider is missing from the catalog', async () => {
    renderGallery(
      {},
      {connections: [{...githubConnection, provider: 'mystery', display_name: 'mystery-acct'}]},
    );

    expect(await screen.findByText('mystery-acct')).toBeVisible();
    expect(within(installedRegion()).getByText(ADDED_META_RE)).toBeVisible();
  });

  test('names the provider once per row — not repeated in the meta line', async () => {
    renderGallery({}, {connections: [githubConnection]});

    await screen.findByText('acme-corp');

    const region = installedRegion();
    expect(within(region).getByText(ADDED_META_RE)).toBeVisible();
    expect(within(region).queryByText('GitHub')).not.toBeInTheDocument();
  });

  test('renders installed cards even when the providers query fails', async () => {
    renderGallery({}, {providersFail: true, connections: [githubConnection]});

    expect(await screen.findByText('acme-corp')).toBeVisible();
    expect(within(installedRegion()).getByText(ADDED_META_RE)).toBeVisible();
    expect(screen.getByRole('link', {name: 'Open acme-corp in github'})).toBeInTheDocument();
    expect(
      within(availableRegion()).getByText("Couldn't load available integrations"),
    ).toBeInTheDocument();
  });

  test('surfaces a connections error only in the installed section (settings context)', async () => {
    renderGallery({}, {connectionsFail: true});

    expect(await screen.findByText("Couldn't load integrations")).toBeInTheDocument();
    expect(screen.queryByText("Couldn't load available integrations")).not.toBeInTheDocument();
    expect(within(availableRegion()).getByRole('link', {name: 'Connect GitHub'})).toBeVisible();
  });

  test('shows the empty state in the settings context', async () => {
    renderGallery({}, {connections: []});

    expect(await screen.findByText('No integrations connected yet')).toBeVisible();
  });
});

describe('IntegrationGallery — available section', () => {
  test('lists every provider with a Connect link, including connected ones', async () => {
    renderGallery({}, {connections: [githubConnection]});

    expect(await screen.findByRole('link', {name: 'Connect GitHub'})).toBeVisible();
    expect(screen.getByRole('link', {name: 'Connect Sentry'})).toBeVisible();
    expect(screen.getByText('Providers available to connect to this workspace.')).toBeVisible();
  });

  test('exposes each available tile as a single link with no nested button', async () => {
    renderGallery({}, {connections: [githubConnection]});

    const link = await screen.findByRole('link', {name: 'Connect GitHub'});

    expect(link).toHaveClass('focus-visible:shadow-button-neutral-focus');
    expect(link.className).not.toContain('shadow-button-secondary');
    expect(within(link).queryByRole('button')).not.toBeInTheDocument();
  });

  test('surfaces a providers error only in the available section', async () => {
    renderGallery({}, {providersFail: true, connections: [githubConnection]});

    expect(await screen.findByText("Couldn't load available integrations")).toBeInTheDocument();
    expect(screen.queryByText("Couldn't load integrations")).not.toBeInTheDocument();
  });

  test('skips providers with no catalog entry', async () => {
    renderGallery(
      {},
      {
        providers: [
          ...defaultProviders,
          {provider: 'mystery', display_name: 'Mystery', capabilities: []},
        ],
      },
    );

    await screen.findByRole('link', {name: 'Connect GitHub'});

    expect(screen.queryByRole('link', {name: 'Connect Mystery'})).not.toBeInTheDocument();
  });
});
