import {defineRoute, useRouteParams, useRouteSearch} from '@shipfox/client-shell/runtime';
import {WorkflowRunPage} from '#pages/workflow-run-page.js';
import {validateWorkflowRunsSearch, workflowRouteParams} from './inputs.js';

export default defineRoute({
  staticData: {layout: 'full-bleed'},
  validateSearch: validateWorkflowRunsSearch,
  component: () => {
    const {wid, pid, workflowRunId} = useRouteParams(workflowRouteParams);
    return <WorkflowRunPage workspaceId={wid} projectId={pid} workflowRunId={workflowRunId} search={useRouteSearch(validateWorkflowRunsSearch)} />;
  },
});
