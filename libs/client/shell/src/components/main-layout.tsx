import {FullPageLoader} from '@shipfox/react-ui/loader';
import {Outlet, useMatches, useParams} from '@tanstack/react-router';
import type {NavTabEntry} from '#contract.js';
import {useMaybeActiveWorkspace} from '#runtime/active-workspace.js';
import {NavBar} from './nav-bar.js';
import {NavTabs} from './nav-tabs.js';

declare module '@tanstack/react-router' {
  interface StaticDataRouteOption {
    layout?: 'full-bleed';
  }
}

export function MainLayout({
  navigation,
  hideProjectNavigation = false,
}: {
  navigation: readonly NavTabEntry[];
  hideProjectNavigation?: boolean;
}) {
  const workspace = useMaybeActiveWorkspace();
  const {pid} = useParams({strict: false}) as {pid?: string};
  const matches = useMatches();
  if (!workspace) return <FullPageLoader />;
  const fullBleed = matches.some((match) => match.staticData.layout === 'full-bleed');
  return (
    <div className="h-screen w-full flex flex-col bg-background-subtle-base">
      <NavBar hideProjectNavigation={hideProjectNavigation} />
      {hideProjectNavigation ? undefined : (
        <NavTabs entries={navigation} scope={pid ? 'project' : 'workspace'} />
      )}
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
