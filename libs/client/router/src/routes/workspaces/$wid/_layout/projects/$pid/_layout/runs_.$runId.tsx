import {WorkflowRunPage} from '@shipfox/client-projects';
import {createFileRoute} from '@tanstack/react-router';

export const Route = createFileRoute('/workspaces/$wid/_layout/projects/$pid/_layout/runs_/$runId')(
  {
    component: WorkflowRunRoute,
  },
);

function WorkflowRunRoute() {
  const {pid, runId} = Route.useParams();
  return <WorkflowRunPage projectId={pid} runId={runId} />;
}
