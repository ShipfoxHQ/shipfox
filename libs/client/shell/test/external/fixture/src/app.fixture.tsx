import '@testing-library/jest-dom/vitest';
import {getLoadedConfig} from '@shipfox/client-config';
import {providerProbe, resetProviderProbe} from '@shipfox/client-shell-fixture-feature';
import {QueryClient} from '@tanstack/react-query';
import {createMemoryHistory} from '@tanstack/react-router';
import {act, render, screen} from '@testing-library/react';
import {ClientApp} from './main.js';
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
  const missingConfig = render(<ClientApp />);

  expect(await screen.findByRole('heading', {name: 'Configuration error'})).toBeVisible();
  expect(screen.getByText('fixtureGreeting')).toBeVisible();
  missingConfig.unmount();

  window.__SHIPFOX_CONFIG__ = {FIXTURE_GREETING: 'Hello from the fixture'};
  resetProviderProbe();
  router.update({
    history: createMemoryHistory({initialEntries: ['/workspaces/workspace/insights']}),
  });
  render(<ClientApp />);

  expect(await screen.findByRole('heading', {name: 'Overridden insights'})).toBeVisible();
  expect(screen.queryByRole('heading', {name: 'Toy insights'})).not.toBeInTheDocument();
  expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
    'Insights first',
    'Insights second',
  ]);
  expect(providerProbe.order).toEqual(['toy-feature', 'app-feature']);
  expect(providerProbe.queryClients).toHaveLength(2);
  expect(providerProbe.queryClients[0]).toBeInstanceOf(QueryClient);
  expect(providerProbe.queryClients[1]).toBe(providerProbe.queryClients[0]);
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
