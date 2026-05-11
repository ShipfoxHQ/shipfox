import {ProjectWorkflowsPage} from '@shipfox/client-projects';
import {createFileRoute} from '@tanstack/react-router';

export const Route = createFileRoute('/workspaces/$wid/_layout/projects/$pid/_layout/workflows')({
  component: ProjectWorkflowsRoute,
});

function ProjectWorkflowsRoute() {
  const {pid} = Route.useParams();
  return <ProjectWorkflowsPage projectId={pid} />;
}
