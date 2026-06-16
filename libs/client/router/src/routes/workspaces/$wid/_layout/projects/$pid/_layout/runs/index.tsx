import {ProjectRunsPage} from '@shipfox/client-projects';
import {createFileRoute} from '@tanstack/react-router';

export const Route = createFileRoute('/workspaces/$wid/_layout/projects/$pid/_layout/runs/')({
  component: ProjectRunsIndexRoute,
});

function ProjectRunsIndexRoute() {
  const {pid} = Route.useParams();
  return <ProjectRunsPage projectId={pid} />;
}
