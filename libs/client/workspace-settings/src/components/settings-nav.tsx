import {Button, Icon} from '@shipfox/react-ui';
import {Link, useMatchRoute} from '@tanstack/react-router';

export function SettingsNav({workspaceId}: {workspaceId: string}) {
  const matchRoute = useMatchRoute();
  const isMembersActive = Boolean(
    matchRoute({to: '/workspaces/$wid/settings/members', params: {wid: workspaceId}}),
  );
  const isRunnersActive = Boolean(
    matchRoute({to: '/workspaces/$wid/settings/runners', params: {wid: workspaceId}}),
  );

  return (
    <nav aria-label="Workspace settings" className="flex flex-col gap-4">
      <Button
        asChild
        variant={isMembersActive ? 'secondary' : 'transparent'}
        className="w-full justify-start"
      >
        <Link
          to="/workspaces/$wid/settings/members"
          params={{wid: workspaceId}}
          aria-current={isMembersActive ? 'page' : undefined}
        >
          <Icon name="userLine" className="size-16" />
          Members
        </Link>
      </Button>
      <Button
        asChild
        variant={isRunnersActive ? 'secondary' : 'transparent'}
        className="w-full justify-start"
      >
        <Link
          to="/workspaces/$wid/settings/runners"
          params={{wid: workspaceId}}
          aria-current={isRunnersActive ? 'page' : undefined}
        >
          <Icon name="settings3Line" className="size-16" />
          Runners
        </Link>
      </Button>
    </nav>
  );
}
