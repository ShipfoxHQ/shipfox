import {defineRoute, useRouteParams} from '@shipfox/client-shell/runtime';
import {ProjectAutomationsPage} from '#pages/project-automations-page.js';
import {workflowRouteParams} from './inputs.js';
import {ProjectRoute} from './project-route.js';

export default defineRoute({
  staticData: {frame: 'data'},
  component: () => {
    const {workspaceSlug, projectSlug} = useRouteParams(workflowRouteParams);
    return (
      <ProjectRoute>
        {(project) => (
          <ProjectAutomationsPage
            projectId={project.id}
            workspaceSlug={workspaceSlug}
            projectSlug={projectSlug}
          />
        )}
      </ProjectRoute>
    );
  },
});
