import {defineRoute, useRouteParams, useRouteSearch} from '@shipfox/client-shell/runtime';
import {normalizeConfigPath} from '#core/config-files.js';
import {ProjectAutomationsPage} from '#pages/project-automations-page.js';
import {automationsFilesRouteParams, validateAutomationsFilesSearch} from './inputs.js';
import {ProjectRoute} from './project-route.js';

export default defineRoute({
  staticData: {frame: 'data'},
  validateSearch: validateAutomationsFilesSearch,
  component: () => {
    const {workspaceSlug, projectSlug, path} = useRouteParams(automationsFilesRouteParams);
    const search = useRouteSearch(validateAutomationsFilesSearch);
    return (
      <ProjectRoute>
        {(project) => (
          <ProjectAutomationsPage
            projectId={project.id}
            workspaceSlug={workspaceSlug}
            projectSlug={projectSlug}
            tab={{
              kind: 'files',
              path: normalizeConfigPath(path),
              view: search.view ?? 'code',
            }}
          />
        )}
      </ProjectRoute>
    );
  },
});
