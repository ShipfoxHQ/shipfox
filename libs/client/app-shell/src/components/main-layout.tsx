import {Outlet} from '@tanstack/react-router';
import {Footer} from './footer.js';
import {NavBar} from './nav-bar.js';
import {ProjectTabs} from './project-tabs.js';

export function MainLayout() {
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
