import {Button} from '@shipfox/react-ui/button';
import {Icon} from '@shipfox/react-ui/icon';
import {Link, useMatchRoute} from '@tanstack/react-router';

export function SettingsNav({workspaceId}: {workspaceId: string}) {
  const matchRoute = useMatchRoute();
  const isMembersActive = Boolean(
    matchRoute({to: '/workspaces/$wid/settings/members', params: {wid: workspaceId}}),
  );
  const isRunnersActive = Boolean(
    matchRoute({to: '/workspaces/$wid/settings/runners', params: {wid: workspaceId}}),
  );
  const isProvisionersActive = Boolean(
    matchRoute({to: '/workspaces/$wid/settings/provisioners', params: {wid: workspaceId}}),
  );
  const isAgentsActive = Boolean(
    matchRoute({to: '/workspaces/$wid/settings/agents', params: {wid: workspaceId}}),
  );
  const isSecretsActive = Boolean(
    matchRoute({to: '/workspaces/$wid/settings/secrets', params: {wid: workspaceId}}),
  );
  const isVariablesActive = Boolean(
    matchRoute({to: '/workspaces/$wid/settings/variables', params: {wid: workspaceId}}),
  );
  const isIntegrationsActive = Boolean(
    matchRoute({to: '/workspaces/$wid/settings/integrations', params: {wid: workspaceId}}),
  );
  const isEventsActive = Boolean(
    matchRoute({to: '/workspaces/$wid/settings/events', params: {wid: workspaceId}}),
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
      <Button
        asChild
        variant={isProvisionersActive ? 'secondary' : 'transparent'}
        className="w-full justify-start"
      >
        <Link
          to="/workspaces/$wid/settings/provisioners"
          params={{wid: workspaceId}}
          aria-current={isProvisionersActive ? 'page' : undefined}
        >
          <Icon name="serverLine" className="size-16" />
          Runner provisioners
        </Link>
      </Button>
      <Button
        asChild
        variant={isAgentsActive ? 'secondary' : 'transparent'}
        className="w-full justify-start"
      >
        <Link
          to="/workspaces/$wid/settings/agents"
          params={{wid: workspaceId}}
          aria-current={isAgentsActive ? 'page' : undefined}
        >
          <Icon name="robot2Line" className="size-16" />
          Agents
        </Link>
      </Button>
      <Button
        asChild
        variant={isSecretsActive ? 'secondary' : 'transparent'}
        className="w-full justify-start"
      >
        <Link
          to="/workspaces/$wid/settings/secrets"
          params={{wid: workspaceId}}
          aria-current={isSecretsActive ? 'page' : undefined}
        >
          <Icon name="keyLine" className="size-16" />
          Secrets
        </Link>
      </Button>
      <Button
        asChild
        variant={isVariablesActive ? 'secondary' : 'transparent'}
        className="w-full justify-start"
      >
        <Link
          to="/workspaces/$wid/settings/variables"
          params={{wid: workspaceId}}
          aria-current={isVariablesActive ? 'page' : undefined}
        >
          <Icon name="bracesLine" className="size-16" />
          Variables
        </Link>
      </Button>
      <Button
        asChild
        variant={isIntegrationsActive ? 'secondary' : 'transparent'}
        className="w-full justify-start"
      >
        <Link
          to="/workspaces/$wid/settings/integrations"
          params={{wid: workspaceId}}
          aria-current={isIntegrationsActive ? 'page' : undefined}
        >
          <Icon name="plugLine" className="size-16" />
          Integrations
        </Link>
      </Button>
      <Button
        asChild
        variant={isEventsActive ? 'secondary' : 'transparent'}
        className="w-full justify-start"
      >
        <Link
          to="/workspaces/$wid/settings/events"
          params={{wid: workspaceId}}
          aria-current={isEventsActive ? 'page' : undefined}
        >
          <Icon name="pulseLine" className="size-16" />
          Events
        </Link>
      </Button>
    </nav>
  );
}
