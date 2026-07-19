import {EventsPage, type TriggerEventFilters} from '@shipfox/client-triggers';
import {getRouteApi} from '@tanstack/react-router';
import {WorkspaceSettingsShell} from '#components/workspace-settings-shell.js';

const routeApi = getRouteApi('/workspaces/$wid/settings/events');

export function EventsSettingsPage() {
  const search = routeApi.useSearch();
  const navigate = routeApi.useNavigate();

  // Merge the patch into the current URL search. Undefined values drop their key, so
  // clearing a filter removes it from the URL. `replace` keeps filter tweaks off the
  // back stack.
  const onFiltersChange = (patch: Partial<TriggerEventFilters>) => {
    void navigate({search: {...search, ...patch}, replace: true});
  };

  return (
    <WorkspaceSettingsShell>
      {(workspace) => (
        <EventsPage workspaceId={workspace.id} filters={search} onFiltersChange={onFiltersChange} />
      )}
    </WorkspaceSettingsShell>
  );
}
