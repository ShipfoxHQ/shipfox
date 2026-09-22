import {defineRoute, useRouteParams} from '@shipfox/client-shell/runtime';
import {WorkflowRunPermalinkPage} from '#pages/workflow-run-permalink-page.js';
import {workflowRunPermalinkRouteParams} from './inputs.js';

export default defineRoute({
  staticData: {frame: 'focused'},
  component: () => {
    const {workflowRunId} = useRouteParams(workflowRunPermalinkRouteParams);
    return <WorkflowRunPermalinkPage workflowRunId={workflowRunId} />;
  },
});
