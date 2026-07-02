import {useMaybeActiveWorkspace} from '@shipfox/client-auth';
import {FullPageLoader} from '@shipfox/react-ui/loader';
import {Outlet, useMatches} from '@tanstack/react-router';
import {NavBar} from './nav-bar.js';
import {ProjectTabs} from './project-tabs.js';

declare module '@tanstack/react-router' {
  interface StaticDataRouteOption {
    // 'full-bleed' lets a route fill the content area edge-to-edge, opting out
    // of the centered, padded column the shell applies to every other page.
    layout?: 'full-bleed';
  }
}

export interface MainLayoutProps {
  hideProjectNavigation?: boolean;
}

export function MainLayout({hideProjectNavigation = false}: MainLayoutProps) {
  // Guard against the brief window where the route matched (e.g., direct
  // navigation to /workspaces/$wid via a deep link or page refresh) but the
  // auth atom hasn't populated `auth.workspaces` yet. NavBar's
  // <WorkspaceCrumb> calls `useActiveWorkspace()` which throws when the
  // workspace can't be found; render the loader until it's resolvable.
  const workspace = useMaybeActiveWorkspace();
  const matches = useMatches();
  if (!workspace) return <FullPageLoader />;

  const fullBleed = matches.some((match) => match.staticData.layout === 'full-bleed');

  return (
    <div className="h-screen w-full flex flex-col bg-background-subtle-base">
      <NavBar hideProjectNavigation={hideProjectNavigation} />
      {hideProjectNavigation ? undefined : <ProjectTabs />}
      {fullBleed ? (
        <main className="flex-1 min-h-0 flex flex-col overflow-hidden">
          <Outlet />
        </main>
      ) : (
        <main className="flex-1 overflow-auto">
          <div className="max-w-[1120px] mx-auto px-24 py-32">
            <Outlet />
          </div>
        </main>
      )}
    </div>
  );
}
