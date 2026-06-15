import {ProjectRunDetailPage} from '@shipfox/client-projects';
import {createFileRoute} from '@tanstack/react-router';

export const Route = createFileRoute('/workspaces/$wid/_layout/projects/$pid/_layout/runs_/$rid')({
  component: ProjectRunDetailRoute,
});

function ProjectRunDetailRoute() {
  const {pid, rid} = Route.useParams();
  return <ProjectRunDetailPage projectId={pid} runId={rid} />;
}
