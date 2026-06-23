import {useActiveWorkspace} from '@shipfox/client-auth';
import {EventsPage, type TriggerEventFilters} from '@shipfox/client-triggers';
import {Header, Text} from '@shipfox/react-ui';
import {getRouteApi} from '@tanstack/react-router';
import {SettingsNav} from '#components/settings-nav.js';

const routeApi = getRouteApi('/workspaces/$wid/_layout/settings/events');

export function EventsSettingsPage() {
  const workspace = useActiveWorkspace();
  const search = routeApi.useSearch();
  const navigate = routeApi.useNavigate();

  // Merge the patch into the current URL search. Undefined values drop their key, so
  // clearing a filter removes it from the URL. `replace` keeps filter tweaks off the
  // back stack.
  const onFiltersChange = (patch: Partial<TriggerEventFilters>) => {
    void navigate({search: {...search, ...patch}, replace: true});
  };

  return (
    <div className="flex w-full flex-col gap-24">
      <header className="flex flex-col gap-6">
        <Header variant="h2">Workspace settings</Header>
        <Text size="sm" className="text-foreground-neutral-muted">
          Configure {workspace.name}.
        </Text>
      </header>

      <div className="grid grid-cols-[180px_minmax(0,1fr)] gap-32 max-[760px]:grid-cols-1">
        <SettingsNav workspaceId={workspace.id} />
        <EventsPage workspaceId={workspace.id} filters={search} onFiltersChange={onFiltersChange} />
      </div>
    </div>
  );
}
