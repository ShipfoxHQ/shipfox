import {useAuthState} from '@shipfox/client-shell/runtime';
import {QueryLoadError} from '@shipfox/client-ui';
import {EmptyState} from '@shipfox/react-ui/empty-state';
import {FullPageLoader} from '@shipfox/react-ui/loader';
import {Navigate} from '@tanstack/react-router';
import {useWorkflowRunPermalinkQuery} from '#hooks/api/workflow-run-permalink.js';

export function WorkflowRunPermalinkPage({workflowRunId}: {workflowRunId: string}) {
  const auth = useAuthState();
  const query = useWorkflowRunPermalinkQuery({
    workflowRunId,
    workspaces: auth.workspaces,
    enabled: auth.isAuthenticated,
  });

  if (auth.isLoading) return <FullPageLoader />;

  if (!auth.isAuthenticated) {
    return <Navigate to="/auth/login" search={{redirect: `/runs/${workflowRunId}`}} replace />;
  }

  if (query.isPending) return <FullPageLoader />;
  if (query.isError) return <QueryLoadError query={query} subject="run" />;

  if (query.data.kind === 'not-found') {
    return (
      <EmptyState
        icon="errorWarningLine"
        title="Run not found"
        description="This run does not exist, or it is no longer available."
      />
    );
  }

  if (query.data.kind === 'no-access') {
    return (
      <EmptyState
        icon="lockLine"
        title="You do not have access to this run"
        description="Ask a workspace member for access to the project that owns this run."
      />
    );
  }

  return (
    <Navigate
      to="/w/$workspaceSlug/p/$projectSlug/runs/$workflowRunId"
      params={{
        workspaceSlug: query.data.workspaceSlug,
        projectSlug: query.data.projectSlug,
        workflowRunId,
      }}
      replace
    />
  );
}
