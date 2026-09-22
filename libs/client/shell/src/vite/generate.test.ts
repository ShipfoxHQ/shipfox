import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {composeLayouts, composeRoutes} from '#compose/compose-routes.js';
import {navigationEntries, settingsEntries} from '#runtime/registries.js';
import {features} from '#test/fixtures/features.js';
import {generateAppModule} from './generate.js';

const goldenFile = fileURLToPath(
  new URL('../../test/typecheck/shipfox-app.gen.ts', import.meta.url),
);

describe('generateAppModule', () => {
  test('matches the checked composition fixture', async () => {
    const generated = generateAppModule({
      routes: composeRoutes(features),
      navigation: navigationEntries(features),
      settingsSections: settingsEntries(features),
    });

    await expect(readFile(goldenFile, 'utf8')).resolves.toBe(generated);
  });

  test('declares nested layout trees from child to parent', () => {
    const nestedFeatures = [
      {
        id: 'nested-layouts',
        layouts: [
          {id: 'nested.outer', path: '/admin', parent: 'root' as const, impl: 'outer'},
          {
            id: 'nested.inner',
            path: '/admin/settings',
            parent: 'nested.outer',
            impl: 'inner',
          },
        ],
        routes: [
          {
            path: '/admin/settings/users',
            parent: 'nested.inner',
            impl: 'users',
          },
        ],
      },
    ];
    const generated = generateAppModule({
      layouts: composeLayouts(nestedFeatures),
      routes: composeRoutes(nestedFeatures),
      navigation: [],
      settingsSections: [],
    });

    expect(generated.indexOf('const layout1Tree')).toBeLessThan(
      generated.indexOf('const layout0Tree'),
    );
  });

  test('qualifies routes that use the same implementation by their parent and path', () => {
    const duplicateImplementationFeatures = [
      {
        id: 'shipfox.members',
        routes: [
          {
            path: '/w/$workspaceSlug/settings/members',
            parent: 'workspaceSettings' as const,
            impl: '@shipfox/client-workspace-settings/routes/members',
          },
          {
            path: '/w/$workspaceSlug/setup/members',
            parent: 'workspaceLayout' as const,
            impl: '@shipfox/client-workspace-settings/routes/members',
          },
        ],
      },
    ];

    const generated = generateAppModule({
      routes: composeRoutes(duplicateImplementationFeatures),
      navigation: [],
      settingsSections: [],
    });

    expect(generated).toContain('const workspaceSettingsMembersRoute = createRoute({');
    expect(generated).toContain('const workspaceSetupMembersRoute = createRoute({');
  });

  test('keeps route names stable when an earlier route is added', () => {
    const workflows = {
      id: 'shipfox.workflows',
      routes: [
        {
          path: '/w/$workspaceSlug/p/$projectSlug/workflows',
          parent: 'projectLayout' as const,
          impl: '@shipfox/client-workflows/routes/workflows',
        },
        {
          path: '/w/$workspaceSlug/p/$projectSlug/runs',
          parent: 'projectLayout' as const,
          impl: '@shipfox/client-workflows/routes/runs',
        },
      ],
    };
    const withPermalink = {
      ...workflows,
      routes: [
        {
          path: '/runs/$workflowRunId',
          parent: 'root' as const,
          impl: '@shipfox/client-workflows/routes/run-permalink',
        },
        ...workflows.routes,
      ],
    };

    const before = generateAppModule({
      routes: composeRoutes([workflows]),
      navigation: [],
      settingsSections: [],
    });
    const after = generateAppModule({
      routes: composeRoutes([withPermalink]),
      navigation: [],
      settingsSections: [],
    });

    expect(before).toContain('const workflowsRoute = createRoute({');
    expect(after).toContain('const workflowsRoute = createRoute({');
    expect(before).toContain('const runsRoute = createRoute({');
    expect(after).toContain('const runsRoute = createRoute({');
    expect(after).toContain('const runPermalinkRoute = createRoute({');
  });
});
