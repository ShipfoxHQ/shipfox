import {defineRoute, useActiveWorkspace} from '@shipfox/client-shell/runtime';
import {getRouteApi} from '@tanstack/react-router';
import type {TriggerEventFilters} from '#hooks/api/trigger-events.js';
import {EventsPage} from '#pages/events-page.js';
import {validateTriggerEventsSearch} from '#search.js';

const routeApi = getRouteApi('/workspaces/$wid/settings/events');

export default defineRoute({
  validateSearch: validateTriggerEventsSearch,
  component: () => {
    const workspace = useActiveWorkspace();
    const search = routeApi.useSearch();
    const navigate = routeApi.useNavigate();
    const onFiltersChange = (patch: Partial<TriggerEventFilters>) => {
      void navigate({search: {...search, ...patch}, replace: true});
    };
    return (
      <EventsPage workspaceId={workspace.id} filters={search} onFiltersChange={onFiltersChange} />
    );
  },
});
