import {createFileRoute, Outlet} from '@tanstack/react-router';

export const Route = createFileRoute('/workspaces/$wid/_layout/projects/$pid/_layout/runs')({
  component: ProjectRunsRoute,
});

function ProjectRunsRoute() {
  return <Outlet />;
}
