import {useActiveWorkspace, WorkspaceCrumb} from '@shipfox/client-auth';
import {ProjectCrumb, useProjectQuery} from '@shipfox/client-projects';
import {Logo} from '@shipfox/react-ui';
import {Link, useParams} from '@tanstack/react-router';
import {UserMenu} from './user-menu.js';

export function NavBar() {
  const workspace = useActiveWorkspace();
  const params = useParams({strict: false}) as {pid?: string};
  const projectQuery = useProjectQuery(params.pid);
  const project = projectQuery.data;

  return (
    <header className="sticky top-0 z-30 h-56 px-16 flex items-center gap-12 bg-background-subtle-base border-b border-border-neutral-base shrink-0">
      <Link
        to="/"
        aria-label="Shipfox home"
        className="rounded-6 focus-visible:outline-none focus-visible:shadow-button-secondary-focus"
      >
        <Logo variant="wordmark" />
      </Link>
      <span className="h-20 w-px bg-border-neutral-base" aria-hidden="true" />
      <WorkspaceCrumb workspace={workspace} />
      <span className="text-foreground-neutral-muted" aria-hidden="true">
        /
      </span>
      <ProjectCrumb
        workspaceId={workspace.id}
        projectId={project?.id}
        projectName={project?.name}
      />
      <div className="flex-1" />
      <UserMenu />
    </header>
  );
}
