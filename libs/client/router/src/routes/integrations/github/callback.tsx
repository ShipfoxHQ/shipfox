import {ApiError, apiRequest} from '@shipfox/client-api';
import {useRefreshAuth} from '@shipfox/client-auth';
import {FullPageLoader, toast} from '@shipfox/react-ui';
import {createFileRoute, useNavigate, useSearch} from '@tanstack/react-router';
import {useEffect} from 'react';

const callbackRequests = new Map<string, Promise<void>>();
const toastedCallbacks = new Set<string>();

export const Route = createFileRoute('/integrations/github/callback')({
  component: GithubCallbackRoute,
});

function GithubCallbackRoute() {
  const search = useSearch({strict: false});
  const navigate = useNavigate();
  const refreshAuth = useRefreshAuth();

  useEffect(() => {
    const params = githubCallbackParams(search);
    if (!params) {
      toast.error('GitHub callback is missing required parameters.');
      navigate({to: '/', replace: true});
      return;
    }

    let disposed = false;
    const key = params.toString();
    let request = callbackRequests.get(key);
    if (!request) {
      request = refreshAuth().then(async (session) => {
        await apiRequest(`/integrations/github/callback/api?${params.toString()}`, {
          headers: {authorization: `Bearer ${session.token}`},
        });
      });
      callbackRequests.set(key, request);
    }

    request
      .then(() => {
        if (disposed) return;
        if (!toastedCallbacks.has(key)) {
          toastedCallbacks.add(key);
          toast.success('GitHub connected.');
        }
        navigate({to: '/', replace: true});
      })
      .catch((error: unknown) => {
        if (disposed) return;
        if (!toastedCallbacks.has(key)) {
          toastedCallbacks.add(key);
          toast.error(githubCallbackErrorMessage(error));
        }
        navigate({to: '/', replace: true});
      });

    return () => {
      disposed = true;
    };
  }, [navigate, refreshAuth, search]);

  return <FullPageLoader />;
}

function githubCallbackParams(search: Record<string, unknown>): URLSearchParams | undefined {
  const code = stringParam(search.code);
  const installationId = stringParam(search.installation_id);
  const state = stringParam(search.state);
  if (!code || !installationId || !state) return undefined;

  const params = new URLSearchParams({
    code,
    installation_id: installationId,
    state,
  });
  const setupAction = stringParam(search.setup_action);
  if (setupAction) params.set('setup_action', setupAction);
  return params;
}

function stringParam(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function githubCallbackErrorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Could not connect GitHub.';
}
