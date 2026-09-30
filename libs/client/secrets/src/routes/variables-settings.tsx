import {defineRoute, useActiveWorkspace} from '@shipfox/client-shell/runtime';
import {getRouteApi} from '@tanstack/react-router';
import {WorkspaceVariablesSection} from '#index.js';
import {type StoreSettingsSearch, validateStoreSettingsSearch} from '#search.js';

const routeApi = getRouteApi('/w/$workspaceSlug/settings/variables');

// Wrapped so the validator's type stays portable to the composed router in apps/client.
function validateSearch(search: Record<string, unknown>): StoreSettingsSearch {
  return validateStoreSettingsSearch(search);
}

export default defineRoute({
  staticData: {frame: 'content'},
  validateSearch,
  component: () => {
    // The router merges unvalidated params from ancestor routes into the match, so a rejected
    // `create` can still surface here; validate again rather than trust the merged search.
    const search = routeApi.useSearch();
    const {create} = validateStoreSettingsSearch(search);
    const navigate = routeApi.useNavigate();
    return (
      <WorkspaceVariablesSection
        workspaceId={useActiveWorkspace().id}
        createKey={create}
        onCreateKeyClear={() =>
          void navigate({search: {...search, create: undefined}, replace: true})
        }
      />
    );
  },
});
