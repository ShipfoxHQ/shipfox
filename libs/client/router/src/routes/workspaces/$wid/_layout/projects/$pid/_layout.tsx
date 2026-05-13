import {useProjectQuery} from '@shipfox/client-projects';
import {createFileRoute, Outlet, useNavigate} from '@tanstack/react-router';
import {useEffect} from 'react';

export const Route = createFileRoute('/workspaces/$wid/_layout/projects/$pid/_layout')({
  component: ProjectLayoutRoute,
});

function ProjectLayoutRoute() {
  const {wid, pid} = Route.useParams();
  const navigate = useNavigate();
  const projectQuery = useProjectQuery(pid);
  const project = projectQuery.data;

  // Workspace-project consistency guard: if the project belongs to a different
  // workspace than the URL claims, replace-navigate to the workspace home so
  // the URL stops lying.
  useEffect(() => {
    if (project && project.workspace_id !== wid) {
      navigate({to: '/workspaces/$wid', params: {wid}, replace: true});
    }
  }, [project, wid, navigate]);

  if (project && project.workspace_id !== wid) return null;

  return <Outlet />;
}
