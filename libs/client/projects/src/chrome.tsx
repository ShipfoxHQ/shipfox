import {useActiveWorkspace} from '@shipfox/client-shell/runtime';
import {Outlet, useNavigate, useParams} from '@tanstack/react-router';
import {useEffect} from 'react';
import {ProjectCrumb} from '#components/project-crumb.js';
import {useProjectQuery} from '#hooks/api/projects.js';

export function ProjectBreadcrumb() {
  const workspace = useActiveWorkspace();
  const {pid} = useParams({strict: false}) as {pid?: string};
  const project = useProjectQuery(pid).data;
  return (
    <ProjectCrumb workspaceId={workspace.id} projectId={project?.id} projectName={project?.name} />
  );
}

export function ProjectLayoutGuard() {
  const {wid, pid} = useParams({strict: false}) as {wid: string; pid: string};
  const navigate = useNavigate();
  const project = useProjectQuery(pid).data;
  useEffect(() => {
    if (project && project.workspace_id !== wid)
      void navigate({to: '/workspaces/$wid', params: {wid}, replace: true});
  }, [navigate, project, wid]);
  if (project && project.workspace_id !== wid) return null;
  return <Outlet />;
}
