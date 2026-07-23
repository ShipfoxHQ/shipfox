import {
  parseWorkspaceProjectParams,
  useActiveWorkspace,
  useRouteParams,
} from '@shipfox/client-shell/runtime';
import {Outlet, useNavigate} from '@tanstack/react-router';
import {useEffect} from 'react';
import {ProjectCrumb} from '#components/project-crumb.js';
import {useProjectQuery} from '#hooks/api/projects.js';
import {projectRouteParams} from './routes/inputs.js';

export function ProjectBreadcrumb() {
  const workspace = useActiveWorkspace();
  const {pid} = useRouteParams(parseWorkspaceProjectParams);
  const project = useProjectQuery(pid).data;
  return (
    <ProjectCrumb workspaceId={workspace.id} projectId={project?.id} projectName={project?.name} />
  );
}

export function ProjectLayoutGuard() {
  const {wid, pid} = useRouteParams(projectRouteParams);
  const navigate = useNavigate();
  const project = useProjectQuery(pid).data;
  useEffect(() => {
    if (project && project.workspaceId !== wid)
      void navigate({to: '/workspaces/$wid', params: {wid}, replace: true});
  }, [navigate, project, wid]);
  if (project && project.workspaceId !== wid) return null;
  return <Outlet />;
}
