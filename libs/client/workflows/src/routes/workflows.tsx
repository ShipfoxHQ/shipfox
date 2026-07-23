import {defineRoute, useRouteParams} from '@shipfox/client-shell/runtime';
import {ProjectWorkflowsPage} from '#pages/project-workflows-page.js';
import {workflowRouteParams} from './inputs.js';

export default defineRoute({
  component: () => {
    const {pid} = useRouteParams(workflowRouteParams);
    return <ProjectWorkflowsPage projectId={pid} />;
  },
});
