import {ApiError} from '@shipfox/client-api';
import {useActiveWorkspace} from '@shipfox/client-auth';
import {useIntegrationConnectionsQuery} from '@shipfox/client-integrations';
import {useAgentPageContext} from '@shipfox/client-shell/runtime';
import {QueryLoadError} from '@shipfox/client-ui';
import {EmptyState} from '@shipfox/react-ui/empty-state';
import {FullPageLoader} from '@shipfox/react-ui/loader';
import {useMaybeActiveProjectQuery} from '#chrome.js';
import {ProjectAccessForm} from '#components/project-access/project-access-form.js';
import {useProjectAccessQuery} from '#hooks/api/project-access.js';

function ProjectNotFound() {
  return (
    <EmptyState
      icon="errorWarningLine"
      tone="error"
      title="Project not found"
      description="This project doesn't exist, or you don't have access to it."
    />
  );
}

export function ProjectAccessPage() {
  const workspace = useActiveWorkspace();
  const projectQuery = useMaybeActiveProjectQuery();
  const project = projectQuery.data ?? undefined;
  const accessQuery = useProjectAccessQuery(project?.id);
  const connectionsQuery = useIntegrationConnectionsQuery(workspace.id);
  useAgentPageContext({page: 'project_settings', section: 'access'});

  if (projectQuery.isPending) return <FullPageLoader />;
  if (projectQuery.isError && projectQuery.data === undefined) {
    if (projectQuery.error instanceof ApiError && projectQuery.error.status === 404) {
      return <ProjectNotFound />;
    }
    return <QueryLoadError query={projectQuery} subject="project" />;
  }
  if (!project) return <ProjectNotFound />;

  if (accessQuery.isPending || connectionsQuery.isPending) return <FullPageLoader />;
  // A failed background refetch keeps the cached data, and the form keeps its draft.
  if (accessQuery.data === undefined) {
    return <QueryLoadError query={accessQuery} subject="project access" />;
  }
  if (connectionsQuery.data === undefined) {
    return <QueryLoadError query={connectionsQuery} subject="integrations" />;
  }

  return (
    <ProjectAccessForm
      key={project.id}
      project={project}
      access={accessQuery.data}
      connections={connectionsQuery.data}
    />
  );
}
