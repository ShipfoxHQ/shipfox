import {useMaybeActiveWorkspace} from '@shipfox/client-auth';
import {FullPageLoader} from '@shipfox/react-ui';
import {Outlet} from '@tanstack/react-router';
import {Footer} from './footer.js';
import {NavBar} from './nav-bar.js';
import {ProjectTabs} from './project-tabs.js';

export function MainLayout() {
  // Guard against the brief window where the route matched (e.g., direct
  // navigation to /workspaces/$wid via a deep link or page refresh) but the
  // auth atom hasn't populated `auth.workspaces` yet. NavBar's
  // <WorkspaceCrumb> calls `useActiveWorkspace()` which throws when the
  // workspace can't be found; render the loader until it's resolvable.
  const workspace = useMaybeActiveWorkspace();
  if (!workspace) return <FullPageLoader />;

  return (
    <div className="h-screen w-full flex flex-col bg-background-subtle-base">
      <NavBar />
      <ProjectTabs />
      <main className="flex-1 overflow-auto">
        <div className="max-w-[1120px] mx-auto px-24 py-32">
          <Outlet />
        </div>
      </main>
      <Footer />
    </div>
  );
}
