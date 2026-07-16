import {screen} from '@testing-library/react';
import {defineClientFeature} from '#contract.js';
import {renderComposedShell} from '#test/render.js';
import {defineRoute} from './define-route.js';

describe('composed routes', () => {
  test('renders a feature-added route through memory history', async () => {
    const feature = defineClientFeature({
      id: 'acme.insights',
      routes: [{path: '/insights', parent: 'root', impl: 'insights'}],
    });

    await renderComposedShell({
      features: [feature],
      initialPath: '/insights',
      resolveImpl: () => defineRoute({component: () => <h1>Insights</h1>}),
    });

    expect(await screen.findByRole('heading', {name: 'Insights'})).toBeVisible();
  });

  test('renders an explicit route override instead of the upstream route', async () => {
    const features = [
      defineClientFeature({
        id: 'shipfox.projects',
        routes: [{path: '/projects', parent: 'root', impl: 'upstream'}],
      }),
      defineClientFeature({
        id: 'acme.projects',
        routes: [{path: '/projects', parent: 'root', override: true, impl: 'override'}],
      }),
    ];

    await renderComposedShell({
      features,
      initialPath: '/projects',
      resolveImpl: (specifier) =>
        defineRoute({
          component: () => (
            <h1>{specifier === 'override' ? 'Commercial projects' : 'Upstream projects'}</h1>
          ),
        }),
    });

    expect(await screen.findByRole('heading', {name: 'Commercial projects'})).toBeVisible();
    expect(screen.queryByText('Upstream projects')).not.toBeInTheDocument();
  });
});
