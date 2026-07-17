import '@testing-library/jest-dom/vitest';
import {getLoadedConfig} from '@shipfox/client-config';
import type {ProviderProbeEntry} from '@shipfox/client-shell-fixture-feature';
import {QueryClient} from '@tanstack/react-query';
import {createMemoryHistory} from '@tanstack/react-router';
import {act, render, screen, waitFor} from '@testing-library/react';
import {createClientAppElement} from './main.js';
import {router} from './shipfox-app.gen.js';

test('proves the external composition contract', async () => {
  window.matchMedia = vi.fn((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(() => false),
  }));
  window.scrollTo = vi.fn();
  window.__SHIPFOX_CONFIG__ = undefined;
  const missingConfig = render(createClientAppElement(), {reactStrictMode: true});

  expect(await screen.findByRole('heading', {name: 'Configuration error'})).toBeVisible();
  expect(screen.getByText('fixtureGreeting')).toBeVisible();
  missingConfig.unmount();

  window.__SHIPFOX_CONFIG__ = {FIXTURE_GREETING: 'Hello from the fixture'};
  let providers: readonly ProviderProbeEntry[] = [];
  router.update({
    history: createMemoryHistory({initialEntries: ['/workspaces/workspace/insights']}),
  });
  render(
    createClientAppElement({
      onProviders: (entries) => {
        providers = entries;
      },
    }),
    {reactStrictMode: true},
  );

  expect(await screen.findByRole('heading', {name: 'Overridden insights'})).toBeVisible();
  expect(screen.queryByRole('heading', {name: 'Toy insights'})).not.toBeInTheDocument();
  expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
    'Insights first',
    'Insights second',
  ]);
  await waitFor(() => expect(providers.map(({id}) => id)).toEqual(['toy-feature', 'app-feature']));
  const queryClients = providers.map(({queryClient}) => queryClient);
  expect(queryClients).toHaveLength(2);
  expect(queryClients[0]).toBeInstanceOf(QueryClient);
  expect(queryClients[1]).toBe(queryClients[0]);
  expect(getLoadedConfig<{fixtureGreeting: string}>().fixtureGreeting).toBe(
    'Hello from the fixture',
  );

  await act(() =>
    router.navigate({
      to: '/workspaces/$wid/settings/primary',
      params: {wid: 'workspace'},
    }),
  );

  expect(await screen.findByRole('heading', {name: 'Toy settings'})).toBeVisible();
  expect(
    Array.from(
      screen.getByRole('navigation', {name: 'Workspace settings'}).querySelectorAll('a'),
      (link) => link.textContent,
    ),
  ).toEqual(['Primary settings', 'Secondary settings']);
});
