// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {screen, within} from '@testing-library/react';
import type {IntegrationConnection, IntegrationProvider} from '#core/models.js';
import {renderIntegrationsPage} from '#test/render.js';
import {ProviderGrid, type ProviderGridProps} from './provider-grid.js';

const ADD_ANOTHER_RE = /Add another/;
const SETUP_ROUTES = [
  '/w/$workspaceSlug/integrations/linear',
  '/w/$workspaceSlug/integrations/slack',
  '/w/$workspaceSlug/integrations/notion',
];

function provider(id: string, displayName: string): IntegrationProvider {
  return {provider: id, displayName, capabilities: ['agent_tools']} as IntegrationProvider;
}

function connection(
  providerId: string,
  overrides: Partial<IntegrationConnection> = {},
): IntegrationConnection {
  return {
    id: `connection-${providerId}`,
    workspaceId: 'workspace-1',
    provider: providerId,
    externalAccountId: `${providerId}-account`,
    slug: `${providerId}_account`,
    displayName: `${providerId} account`,
    lifecycleStatus: 'active',
    capabilities: ['agent_tools'],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function renderGrid(props: Partial<ProviderGridProps> = {}) {
  return renderIntegrationsPage({
    path: '/grid',
    routePath: '/grid',
    element: (
      <ProviderGrid
        workspaceSlug="acme"
        providers={[
          provider('linear', 'Linear'),
          provider('slack', 'Slack'),
          provider('notion', 'Notion'),
        ]}
        isPending={false}
        emptyMessage="Nothing here."
        {...props}
      />
    ),
    extraRoutes: SETUP_ROUTES,
  });
}

function cellOf(name: string): HTMLElement {
  const cell = screen.getByText(name).closest('li');
  if (!cell) throw new Error(`No cell for ${name}`);
  return cell;
}

describe('ProviderGrid connection state', () => {
  test('renders every provider as an install cell without the opt-in', async () => {
    renderGrid({connections: [connection('linear')]});

    expect(await screen.findByRole('link', {name: 'Install Linear'})).toBeVisible();
    expect(screen.getByRole('link', {name: 'Install Slack'})).toBeVisible();
    expect(screen.queryByText('Connected')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', {name: ADD_ANOTHER_RE})).not.toBeInTheDocument();
  });

  test('shows a provider without a connection as installable', async () => {
    renderGrid({showConnectionState: true, connections: []});

    expect(await screen.findByRole('link', {name: 'Install Linear'})).toBeVisible();
    expect(screen.queryByText('Connected')).not.toBeInTheDocument();
  });

  test('marks a provider with an active connection as connected', async () => {
    renderGrid({showConnectionState: true, connections: [connection('linear')]});

    await screen.findByText('Connected');
    const cell = cellOf('Linear');
    expect(within(cell).getByText('Connected')).toBeVisible();
    expect(within(cell).getByRole('link', {name: 'Add another Linear'})).toBeVisible();
    expect(screen.queryByRole('link', {name: 'Install Linear'})).not.toBeInTheDocument();
  });

  test('keeps a connected provider in place beside one that is not connected', async () => {
    renderGrid({showConnectionState: true, connections: [connection('slack')]});

    await screen.findByText('Connected');
    const names = screen.getAllByRole('listitem').map((item) => item.textContent ?? '');
    expect(names.map((text) => text.replace(/Connected|Add another|Install/g, '').trim())).toEqual([
      'Linear',
      'Slack',
      'Notion',
    ]);
    expect(within(cellOf('Slack')).getByText('Connected')).toBeVisible();
    expect(within(cellOf('Linear')).queryByText('Connected')).not.toBeInTheDocument();
    expect(screen.getByRole('link', {name: 'Install Linear'})).toBeVisible();
  });

  test.each(['disabled', 'error'] as const)('ignores a %s connection', async (lifecycleStatus) => {
    renderGrid({
      showConnectionState: true,
      connections: [connection('linear', {lifecycleStatus})],
    });

    expect(await screen.findByRole('link', {name: 'Install Linear'})).toBeVisible();
    expect(screen.queryByText('Connected')).not.toBeInTheDocument();
  });

  test('starts the same install from "Add another" as from "Install"', async () => {
    renderGrid({showConnectionState: true, connections: [connection('linear')]});
    const addAnother = await screen.findByRole('link', {name: 'Add another Linear'});
    renderGrid({});
    const install = await screen.findByRole('link', {name: 'Install Linear'});

    expect(addAnother.getAttribute('href')).toBe('/w/acme/integrations/linear');
    expect(addAnother.getAttribute('href')).toBe(install.getAttribute('href'));
  });
});

describe('ProviderGrid return target', () => {
  test('adds no search to an install link by default', async () => {
    renderGrid({});

    const install = await screen.findByRole('link', {name: 'Install Linear'});
    expect(install.getAttribute('href')).toBe('/w/acme/integrations/linear');
  });

  test('passes the return target to the install link and to "Add another"', async () => {
    renderGrid({showConnectionState: true, connections: [connection('linear')], returnTo: 'home'});

    const addAnother = await screen.findByRole('link', {name: 'Add another Linear'});
    const install = screen.getByRole('link', {name: 'Install Slack'});
    expect(addAnother.getAttribute('href')).toBe('/w/acme/integrations/linear?returnTo=home');
    expect(install.getAttribute('href')).toBe('/w/acme/integrations/slack?returnTo=home');
  });
});
