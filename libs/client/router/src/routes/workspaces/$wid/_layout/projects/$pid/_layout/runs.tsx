import {WorkflowRunPage} from '@shipfox/client-workflows';
import {createFileRoute} from '@tanstack/react-router';

export const Route = createFileRoute('/workspaces/$wid/_layout/projects/$pid/_layout/runs')({
  staticData: {layout: 'full-bleed'},
  component: ProjectRunsRoute,
});

function ProjectRunsRoute() {
  const {wid, pid} = Route.useParams();
  return <WorkflowRunPage workspaceId={wid} projectId={pid} />;
}
