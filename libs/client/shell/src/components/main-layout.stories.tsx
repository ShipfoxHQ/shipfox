import {Button} from '@shipfox/react-ui/button';
import {Text} from '@shipfox/react-ui/typography';
import type {Meta, StoryObj} from '@storybook/react';
import {QueryClient} from '@tanstack/react-query';
import {
  type AnyRouter,
  createMemoryHistory,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import {createStore} from 'jotai';
import {useEffect, useMemo, useState} from 'react';
import {expect, waitFor, within} from 'storybook/test';
import {composeClientFeatures} from '#compose/compose-client-features.js';
import {defineClientFeature} from '#contract.js';
import {assembleRouteTree} from '#runtime/assemble-route-tree.js';
import {type AuthStateValue, authStateAtom} from '#runtime/auth.js';
import {ChromeProvider, type ChromeSlots} from '#runtime/chrome-context.js';
import {defineRoute} from '#runtime/define-route.js';
import {ShellProviders} from '../testing/index.js';
import {ProjectDockPanel} from './project-dock-panel.js';

const WORKSPACE = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Acme Workspace',
  slug: 'acme',
  membershipId: '10000000-0000-4000-8000-000000000001',
};

const AUTH: AuthStateValue = {
  status: 'authenticated',
  token: 'story-access-token',
  user: {id: '00000000-0000-4000-8000-00000000000a', email: 'demo@shipfox.dev'},
  workspaces: [WORKSPACE],
  isLoading: false,
  isAuthenticated: true,
  hasWorkspace: true,
};

const SHELL_STORY_FEATURE = defineClientFeature({
  id: 'acme.shell-story',
  routes: [
    {path: '/w/$workspaceSlug/overview', parent: 'workspaceLayout', impl: 'overview'},
    {path: '/w/$workspaceSlug/projects', parent: 'workspaceLayout', impl: 'projects'},
    {path: '/w/$workspaceSlug/runners', parent: 'workspaceLayout', impl: 'runners'},
    {path: '/w/$workspaceSlug/p/$projectSlug/runs', parent: 'projectLayout', impl: 'runs'},
  ],
  navigation: [
    {id: 'overview', label: 'Overview', to: '/w/$workspaceSlug/overview', scope: 'workspace'},
    {id: 'projects', label: 'Projects', to: '/w/$workspaceSlug/projects', scope: 'workspace'},
    {id: 'runners', label: 'Runners', to: '/w/$workspaceSlug/runners', scope: 'workspace'},
    {id: 'runs', label: 'Runs', to: '/w/$workspaceSlug/p/$projectSlug/runs', scope: 'project'},
  ],
});

const PROJECT_DOCK_FEATURE = defineClientFeature({
  id: 'acme.project-dock',
  projectDock: {load: async () => ({default: DemoProjectDock})},
});

function DemoProjectDock() {
  return (
    <ProjectDockPanel label="Shippy">
      <Text size="sm" className="px-row py-row text-foreground-neutral-muted">
        Dock content
      </Text>
    </ProjectDockPanel>
  );
}

/** A full-height list with its pagination on the floor of the frame, like the Runs page. */
function ProjectRunsPage() {
  return (
    <div className="flex min-h-0 flex-1 flex-col justify-between rounded-8 border border-border-neutral-base bg-background-neutral-base">
      <Text size="sm" className="px-row py-row text-foreground-neutral-muted">
        Runs
      </Text>
      <div className="flex justify-end border-t border-border-neutral-base px-row py-row">
        <Button variant="secondary" size="sm">
          Next
        </Button>
      </div>
    </div>
  );
}

/** Generic filler for the session-banner slot; impersonation UI never ships here. */
function DemoSessionBanner() {
  return (
    <div className="flex h-full items-center justify-center gap-cluster bg-background-neutral-base px-row text-xs font-medium text-foreground-neutral-base">
      <span className="size-8 rounded-full bg-background-highlight-base" aria-hidden="true" />
      Session banner slot
    </div>
  );
}

function EmptySessionBanner() {
  return null;
}

function DemoHeaderAction() {
  return (
    <Button variant="transparent" size="sm" className="text-foreground-neutral-subtle">
      Help
    </Button>
  );
}

function OverviewPage() {
  return (
    <div className="flex flex-col gap-cluster">
      <Text size="md" className="text-foreground-neutral-base">
        Overview
      </Text>
      <Text size="sm" className="text-foreground-neutral-muted">
        Workspace content rendered inside the shell frame below the navigation chrome.
      </Text>
    </div>
  );
}

const TALL_PAGE_ROWS = Array.from({length: 40}, (_, row) => `row-${row}`);

/** A page taller than the viewport, so `content` frames scroll under the launcher's corner. */
function TallProjectPage() {
  return (
    <div className="flex flex-col gap-cluster">
      {TALL_PAGE_ROWS.map((row) => (
        <div
          key={row}
          className="h-40 rounded-8 border border-border-neutral-base bg-background-neutral-base"
        />
      ))}
    </div>
  );
}

function MainLayoutStory({
  withSessionBanner,
  showSessionBanner,
  withHeaderAction,
  hideProjectNavigation,
  projectDock,
  tallContentFrame,
}: {
  withSessionBanner: boolean;
  showSessionBanner: boolean;
  withHeaderAction: boolean;
  hideProjectNavigation: boolean;
  projectDock?: 'floating' | 'tab_bar' | 'open' | undefined;
  tallContentFrame?: boolean | undefined;
}) {
  const queryClient = useMemo(
    () => new QueryClient({defaultOptions: {queries: {retry: false}}}),
    [],
  );
  const features = useMemo(
    () => (projectDock ? [SHELL_STORY_FEATURE, PROJECT_DOCK_FEATURE] : [SHELL_STORY_FEATURE]),
    [projectDock],
  );
  const store = useMemo(() => {
    window.localStorage.removeItem('shipfox.shippy.placement');
    window.localStorage.removeItem('shipfox.projectDock.open');
    if (projectDock === 'tab_bar') {
      window.localStorage.setItem('shipfox.shippy.placement', 'tab_bar');
    }
    if (projectDock === 'open') window.localStorage.setItem('shipfox.projectDock.open', 'true');
    const nextStore = createStore();
    nextStore.set(authStateAtom, AUTH);
    return nextStore;
  }, [projectDock]);
  const chrome = useMemo<ChromeSlots>(
    () => ({
      ProjectBreadcrumb: () => null,
      projectSlugResolver: async () => 'project',
      ...(withSessionBanner
        ? {SessionBanner: showSessionBanner ? DemoSessionBanner : EmptySessionBanner}
        : {}),
      ...(withHeaderAction ? {HeaderActions: DemoHeaderAction} : {}),
    }),
    [showSessionBanner, withHeaderAction, withSessionBanner],
  );
  const [router, setRouter] = useState<AnyRouter | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const composition = composeClientFeatures(features);
      const routeTree = await assembleRouteTree(composition.routes, {
        layouts: composition.layouts,
        resolveImpl: (specifier) => {
          if (specifier !== 'runs') {
            return defineRoute({staticData: {frame: 'content'}, component: OverviewPage});
          }
          return tallContentFrame
            ? defineRoute({staticData: {frame: 'content'}, component: TallProjectPage})
            : defineRoute({staticData: {frame: 'data'}, component: ProjectRunsPage});
        },
        navigation: composition.navigation,
        settingsSections: composition.settingsSections,
      });
      if (cancelled) return;
      setRouter(
        createRouter({
          routeTree,
          history: createMemoryHistory({
            initialEntries: [projectDock ? '/w/acme/p/payments/runs' : '/w/acme/overview'],
          }),
          context: {
            auth: AUTH,
            queryClient,
            workspaceSetup: async () => ({hideProjectNavigation}),
            projectSlugResolver: chrome.projectSlugResolver,
          },
        }),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [queryClient, chrome, hideProjectNavigation, features, projectDock, tallContentFrame]);

  // The provider stack mounts on the first render, before the async router
  // assembly resolves, so its ThemeProvider commits together with the preview
  // decorator's ThemeProvider. React flushes child effects before the parent's
  // on mount, so the preview's theme (the Argos mode) is applied last and stays
  // authoritative; if the stack mounted only after the router resolved, its
  // system-default ThemeProvider would clobber the mode's dark class and every
  // snapshot would render light. The router content is gated below instead.
  return (
    <ChromeProvider chrome={chrome}>
      <ShellProviders features={features} queryClient={queryClient} store={store}>
        {router ? <RouterProvider router={router} /> : null}
      </ShellProviders>
    </ChromeProvider>
  );
}

const meta = {
  title: 'Shell/MainLayout',
  component: MainLayoutStory,
  parameters: {
    layout: 'fullscreen',
  },
  args: {
    withSessionBanner: true,
    showSessionBanner: true,
    withHeaderAction: false,
    hideProjectNavigation: false,
  },
} satisfies Meta<typeof MainLayoutStory>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  play: async ({canvasElement}) => {
    const canvas = within(canvasElement);
    const main = await canvas.findByRole('main');
    // The Argos dark mode must stay authoritative on the preview document; the
    // shell provider stack's system-default ThemeProvider would otherwise leave
    // snapshots light (see the MainLayoutStory mount-order comment above).
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    await waitFor(() => {
      const banner = canvas.getByText('Session banner slot');
      const strip = banner.parentElement;
      expect(strip).not.toBeNull();
      const expectedHeight = `calc(100dvh - ${96 + Math.round((strip as HTMLElement).getBoundingClientRect().height)}px)`;
      expect(main.style.getPropertyValue('--app-content-h')).toBe(expectedHeight);
    });
  },
};

export const WithHeaderAction: Story = {
  args: {
    withHeaderAction: true,
  },
};

export const WithoutBanner: Story = {
  args: {
    withSessionBanner: false,
  },
};

export const EmptyBanner: Story = {
  args: {
    showSessionBanner: false,
  },
};

export const HideProjectNavigation: Story = {
  args: {
    hideProjectNavigation: true,
  },
};

export const ProjectDockFloating: Story = {
  args: {withSessionBanner: false, projectDock: 'floating'},
  play: async ({canvasElement}) => {
    const canvas = within(canvasElement);
    const shippy = await canvas.findByRole('button', {name: 'Open Shippy, your project agent'});
    expect(shippy.querySelector('img')).toHaveAttribute('data-pose', 'body');
    const next = canvas.getByRole('button', {name: 'Next'}).getBoundingClientRect();
    const launcher = shippy.getBoundingClientRect();
    expect(next.bottom).toBeLessThanOrEqual(launcher.top);
  },
};

const assertMainStopsAboveShippy: Story['play'] = async ({canvasElement}) => {
  const canvas = within(canvasElement);
  const shippy = await canvas.findByRole('button', {name: 'Open Shippy, your project agent'});
  expect(shippy.querySelector('img')).toHaveAttribute('data-pose', 'body');
  const main = canvas.getByRole('main').getBoundingClientRect();
  expect(main.bottom).toBeLessThanOrEqual(shippy.getBoundingClientRect().top);
};

export const ProjectDockTallContentFrame: Story = {
  args: {withSessionBanner: false, projectDock: 'floating', tallContentFrame: true},
  play: assertMainStopsAboveShippy,
};

export const ProjectDockTabBar: Story = {
  args: {withSessionBanner: false, projectDock: 'tab_bar'},
};

export const ProjectDockOpen: Story = {
  args: {withSessionBanner: false, projectDock: 'open'},
};
