import {AuthGuard, WorkspaceGuard} from '@shipfox/client-auth';
import {ProjectsHubPage} from '@shipfox/client-projects';
import {toast} from '@shipfox/react-ui';
import {createFileRoute} from '@tanstack/react-router';
import {useEffect} from 'react';

export const Route = createFileRoute('/')({
  component: IndexRoute,
});

function IndexRoute() {
  useIntegrationStatusToast();

  return (
    <AuthGuard>
      <WorkspaceGuard>
        <ProjectsHubPage />
      </WorkspaceGuard>
    </AuthGuard>
  );
}

function useIntegrationStatusToast() {
  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    if (searchParams.get('integration_provider') !== 'github') return;

    const status = searchParams.get('integration_status');
    if (status === 'connected') {
      toast.success('GitHub connected.');
    } else if (status === 'error') {
      toast.error(searchParams.get('integration_error_message') ?? 'Could not connect GitHub.');
    } else {
      return;
    }

    const url = new URL(window.location.href);
    url.searchParams.delete('integration_provider');
    url.searchParams.delete('integration_status');
    url.searchParams.delete('integration_error_code');
    url.searchParams.delete('integration_error_message');
    window.history.replaceState(window.history.state, '', url);
  }, []);
}
