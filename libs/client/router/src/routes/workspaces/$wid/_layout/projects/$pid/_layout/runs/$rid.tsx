import {ProjectWorkflowRunPage} from '@shipfox/client-projects';
import {createFileRoute} from '@tanstack/react-router';

export const Route = createFileRoute('/workspaces/$wid/_layout/projects/$pid/_layout/runs/$rid')({
  component: ProjectWorkflowRunRoute,
});

function ProjectWorkflowRunRoute() {
  const {pid, rid, wid} = Route.useParams();
  return <ProjectWorkflowRunPage projectId={pid} runId={rid} workspaceId={wid} />;
}
