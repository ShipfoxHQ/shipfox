import {screen} from '@testing-library/react';
import {defineClientFeature} from '#contract.js';
import {renderComposedShell} from '#test/render.js';
import {defineRoute} from './define-route.js';

describe('composition registries', () => {
  test('sorts navigation and settings entries by order, feature position, then declaration order', async () => {
    const features = [
      defineClientFeature({
        id: 'shipfox.first',
        navigation: [
          {
            id: 'first-a',
            scope: 'workspace',
            label: 'First A',
            to: '/workspaces/$wid/first-a',
            order: 100,
          },
          {
            id: 'first-b',
            scope: 'workspace',
            label: 'First B',
            to: '/workspaces/$wid/first-b',
            order: 100,
          },
        ],
        settingsSections: [
          {id: 'first', pathSegment: 'first', label: 'First setting', icon: 'userLine', order: 100},
        ],
        routes: [
          {path: '/workspaces/$wid/first-a', parent: 'workspaceLayout', impl: 'first-a'},
          {path: '/workspaces/$wid/first-b', parent: 'workspaceLayout', impl: 'first-b'},
          {
            path: '/workspaces/$wid/settings/first',
            parent: 'workspaceSettings',
            impl: 'first-setting',
          },
        ],
      }),
      defineClientFeature({
        id: 'acme.second',
        navigation: [
          {
            id: 'second',
            scope: 'workspace',
            label: 'Second',
            to: '/workspaces/$wid/second',
            order: 100,
          },
        ],
        settingsSections: [
          {
            id: 'second',
            pathSegment: 'second',
            label: 'Second setting',
            icon: 'userLine',
            order: 200,
          },
        ],
        routes: [
          {path: '/workspaces/$wid/second', parent: 'workspaceLayout', impl: 'second'},
          {
            path: '/workspaces/$wid/settings/second',
            parent: 'workspaceSettings',
            impl: 'second-setting',
          },
        ],
      }),
    ];

    await renderComposedShell({
      features,
      initialPath: '/workspaces/workspace/settings/first',
      resolveImpl: () => defineRoute({component: () => <h1>Settings page</h1>}),
    });

    expect((await screen.findAllByRole('tab')).map((tab) => tab.textContent)).toEqual([
      'First A',
      'First B',
      'Second',
    ]);
    expect(screen.getAllByRole('link').map((link) => link.textContent)).toEqual([
      'First setting',
      'Second setting',
    ]);
  });
});
