import {WorkflowRunPage} from '@shipfox/client-workflows';
import {createFileRoute} from '@tanstack/react-router';

export const Route = createFileRoute(
  '/workspaces/$wid/_layout/projects/$pid/_layout/runs_/$workflowRunId',
)({
  staticData: {layout: 'full-bleed'},
  component: WorkflowRunRoute,
});

function WorkflowRunRoute() {
  const {wid, pid, workflowRunId} = Route.useParams();
  return <WorkflowRunPage workspaceId={wid} projectId={pid} workflowRunId={workflowRunId} />;
}
