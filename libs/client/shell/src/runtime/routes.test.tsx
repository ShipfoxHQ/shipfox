import {Link, Outlet} from '@tanstack/react-router';
import {screen, waitFor, within} from '@testing-library/react';
import {defineClientFeature} from '#contract.js';
import {renderComposedShell} from '#test/render.js';
import {defineRoute} from './define-route.js';
import {useLayoutNavigation} from './layout-navigation.js';

describe('composed routes', () => {
  test('renders an unresolved workspace slot before setup and project resolution', async () => {
    const routeBeforeLoad = vi.fn();
    const routeLoader = vi.fn();
    const projectSlugResolver = vi.fn(async () => 'project');
    const workspaceSetup = vi.fn(async () => ({hideProjectNavigation: false}));
    const UnresolvedWorkspace = ({
      requestedHref,
      workspaceSlug,
    }: {
      requestedHref: string;
      workspaceSlug: string;
    }) => (
      <div>
        <h1>Workspace recovery</h1>
        <output data-testid="unresolved-workspace-props">
          {workspaceSlug}:{requestedHref}
        </output>
      </div>
    );

    await renderComposedShell({
      features: [
        defineClientFeature({
          id: 'acme.overview',
          routes: [
            {
              path: '/w/$workspaceSlug/p/$projectSlug/overview',
              parent: 'projectLayout',
              impl: 'overview',
            },
          ],
        }),
      ],
      initialPath: '/w/missing/p/project/overview?tab=run%2Cfailed#details',
      resolveImpl: () =>
        defineRoute({
          staticData: {frame: 'content'},
          beforeLoad: routeBeforeLoad,
          loader: routeLoader,
          component: () => <h1>Overview</h1>,
        }),
      chrome: {UnresolvedWorkspace, projectSlugResolver},
      workspaceSetup,
    });

    expect(await screen.findByRole('heading', {name: 'Workspace recovery'})).toBeVisible();
    expect(screen.getByTestId('unresolved-workspace-props')).toHaveTextContent(
      'missing:/w/missing/p/project/overview?tab=run%2Cfailed#details',
    );
    expect(projectSlugResolver).not.toHaveBeenCalled();
    expect(workspaceSetup).not.toHaveBeenCalled();
    expect(routeBeforeLoad).not.toHaveBeenCalled();
    expect(routeLoader).not.toHaveBeenCalled();
  });

  test('uses the public href for an unresolved workspace with a same-origin rewrite', async () => {
    const UnresolvedWorkspace = ({
      requestedHref,
      workspaceSlug,
    }: {
      requestedHref: string;
      workspaceSlug: string;
    }) => (
      <output data-testid="unresolved-workspace-props">
        {workspaceSlug}:{requestedHref}
      </output>
    );

    await renderComposedShell({
      features: [
        defineClientFeature({
          id: 'acme.overview',
          routes: [
            {
              path: '/w/$workspaceSlug/p/$projectSlug/overview',
              parent: 'projectLayout',
              impl: 'overview',
            },
          ],
        }),
      ],
      initialPath: '/public/w/missing/p/project/overview?tab=run%2Cfailed#details',
      rewrite: {
        input: ({url}) => {
          url.pathname = url.pathname.slice('/public'.length);
          return url;
        },
      },
      resolveImpl: () =>
        defineRoute({staticData: {frame: 'content'}, component: () => <h1>Overview</h1>}),
      chrome: {UnresolvedWorkspace},
    });

    expect(await screen.findByTestId('unresolved-workspace-props')).toHaveTextContent(
      'missing:/public/w/missing/p/project/overview?tab=run%2Cfailed#details',
    );
  });

  test('keeps the legacy redirect when the unresolved workspace slot is absent', async () => {
    const {router} = await renderComposedShell({
      features: [
        defineClientFeature({
          id: 'acme.overview',
          routes: [
            {
              path: '/w/$workspaceSlug/overview',
              parent: 'workspaceLayout',
              impl: 'overview',
            },
          ],
        }),
      ],
      initialPath: '/w/missing/overview?tab=run#details',
      resolveImpl: () =>
        defineRoute({staticData: {frame: 'content'}, component: () => <h1>Overview</h1>}),
    });

    await waitFor(() => {
      expect((router as {state: {location: {href: string}}}).state.location.href).toBe('/');
    });
  });

  test('renders a feature-added route through memory history', async () => {
    const feature = defineClientFeature({
      id: 'acme.insights',
      routes: [{path: '/insights', parent: 'root', impl: 'insights'}],
    });

    await renderComposedShell({
      features: [feature],
      initialPath: '/insights',
      resolveImpl: () =>
        defineRoute({staticData: {frame: 'focused'}, component: () => <h1>Insights</h1>}),
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
          staticData: {frame: 'focused'},
          component: () => (
            <h1>{specifier === 'override' ? 'Commercial projects' : 'Upstream projects'}</h1>
          ),
        }),
    });

    expect(await screen.findByRole('heading', {name: 'Commercial projects'})).toBeVisible();
    expect(screen.queryByText('Upstream projects')).not.toBeInTheDocument();
  });

  test('renders deterministic navigation supplied by child features to a layout', async () => {
    const features = [
      defineClientFeature({
        id: 'acme.admin',
        layouts: [
          {
            id: 'acme.admin.layout',
            path: '/w/$workspaceSlug/admin',
            parent: 'workspaceLayout',
            impl: 'layout',
          },
        ],
      }),
      defineClientFeature({
        id: 'acme.users',
        routes: [
          {
            path: '/w/$workspaceSlug/admin/users',
            parent: 'acme.admin.layout',
            impl: 'users',
          },
        ],
        navigation: [
          {
            id: 'admin.users',
            scope: 'layout',
            layout: 'acme.admin.layout',
            label: 'Users',
            to: '/w/$workspaceSlug/admin/users',
            order: 200,
          },
        ],
      }),
      defineClientFeature({
        id: 'acme.overview',
        routes: [
          {
            path: '/w/$workspaceSlug/admin/overview',
            parent: 'acme.admin.layout',
            impl: 'overview',
          },
        ],
        navigation: [
          {
            id: 'admin.overview',
            scope: 'layout',
            layout: 'acme.admin.layout',
            label: 'Overview',
            to: '/w/$workspaceSlug/admin/overview',
            order: 100,
          },
        ],
      }),
    ];

    await renderComposedShell({
      features,
      initialPath: '/w/workspace/admin/users',
      resolveImpl: (specifier) => {
        if (specifier === 'layout') {
          return defineRoute({
            staticData: {frame: 'data'},
            component: () => (
              <>
                <nav aria-label="Administration sections">
                  {useLayoutNavigation('acme.admin.layout').map((entry) => (
                    <Link key={entry.id} to={entry.to as never}>
                      {entry.label}
                    </Link>
                  ))}
                </nav>
                <Outlet />
              </>
            ),
          });
        }
        return defineRoute({
          staticData: {frame: 'content'},
          component: () => <h1>{specifier}</h1>,
        });
      },
    });

    const sectionLinks = within(
      await screen.findByRole('navigation', {name: 'Administration sections'}),
    ).getAllByRole('link');
    expect(sectionLinks.map((link) => link.textContent)).toEqual(['Overview', 'Users']);
    expect(await screen.findByRole('heading', {name: 'users'})).toBeVisible();
    const main = await screen.findByRole('main');
    expect(main).toHaveClass('overflow-auto');
    expect(main.firstElementChild).toHaveClass('max-w-[1120px]');
  });

  test.each([
    {
      frame: 'content' as const,
      mainClass: 'overflow-auto',
      frameClass: 'max-w-[1120px]',
    },
    {
      frame: 'data' as const,
      mainClass: 'overflow-hidden',
      frameClass: 'flex-1',
    },
    {
      frame: 'focused' as const,
      mainClass: 'overflow-auto',
      frameClass: 'max-w-[640px]',
    },
  ])('renders the $frame page frame from route static data', async ({
    frame,
    mainClass,
    frameClass,
  }) => {
    const feature = defineClientFeature({
      id: 'acme.frames',
      routes: [{path: '/w/$workspaceSlug/frames', parent: 'workspaceLayout', impl: 'frames'}],
    });

    await renderComposedShell({
      features: [feature],
      initialPath: '/w/workspace/frames',
      resolveImpl: () =>
        defineRoute({
          staticData: {frame},
          component: () => <h1>Frames</h1>,
        }),
    });

    expect(await screen.findByRole('heading', {name: 'Frames'})).toBeVisible();
    const main = screen.getByRole('main');
    const frameContainer = main.firstElementChild;
    expect(main).toHaveClass(mainClass);
    expect(frameContainer).toHaveClass(frameClass);
  });

  test('rejects routes without a declared frame', async () => {
    const feature = defineClientFeature({
      id: 'acme.default-frame',
      routes: [
        {path: '/w/$workspaceSlug/default-frame', parent: 'workspaceLayout', impl: 'default'},
      ],
    });

    await expect(
      renderComposedShell({
        features: [feature],
        initialPath: '/w/workspace/default-frame',
        resolveImpl: () => defineRoute({component: () => <h1>Missing frame</h1>} as never),
      }),
    ).rejects.toThrow(
      'Route implementation "default" for "/w/$workspaceSlug/default-frame" must declare staticData.frame',
    );
  });
});
