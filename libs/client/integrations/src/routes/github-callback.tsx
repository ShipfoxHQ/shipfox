import {ApiError, apiRequest} from '@shipfox/client-api';
import {useRefreshAuth} from '@shipfox/client-auth';
import {defineRoute} from '@shipfox/client-shell/runtime';
import {FullPageLoader} from '@shipfox/react-ui/loader';
import {toast} from '@shipfox/react-ui/toast';
import {useNavigate, useSearch} from '@tanstack/react-router';
import {useEffect} from 'react';

interface GithubCallbackParams {
  code: string;
  installationId: number;
  state: string;
  setupAction?: string;
}

const callbackRequests = new Map<string, Promise<void>>();
const toastedCallbacks = new Set<string>();

export default defineRoute({component: GithubCallbackRoute});

function GithubCallbackRoute() {
  const search = useSearch({strict: false});
  const navigate = useNavigate();
  const refreshAuth = useRefreshAuth();

  useEffect(() => {
    const missing = missingCallbackParams(search);
    if (missing.length > 0) {
      toast.error(
        `GitHub callback is missing: ${missing.join(', ')}. ${missing.includes('code') ? 'Enable "Request user authorization (OAuth) during installation" on the Shipfox GitHub App.' : ''}`,
      );
      navigate({to: '/', replace: true});
      return;
    }
    const params = githubCallbackParams(search);
    if (!params) {
      toast.error('GitHub callback is missing required parameters.');
      navigate({to: '/', replace: true});
      return;
    }
    let disposed = false;
    const key = encodeCallbackQuery(params);
    const request =
      callbackRequests.get(key) ??
      refreshAuth().then(async (session) => {
        await apiRequest(`/integrations/github/callback/api?${key}`, {
          headers: {authorization: `Bearer ${session.token}`},
        });
      });
    callbackRequests.set(key, request);
    request
      .then(() => {
        if (disposed) return;
        if (!toastedCallbacks.has(key)) {
          toastedCallbacks.add(key);
          toast.success('GitHub installed.');
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

function missingCallbackParams(search: Record<string, unknown>): string[] {
  const missing: string[] = [];
  if (!stringParam(search.code)) missing.push('code');
  if (!numberParam(search.installation_id)) missing.push('installation_id');
  if (!stringParam(search.state)) missing.push('state');
  return missing;
}
function githubCallbackParams(search: Record<string, unknown>): GithubCallbackParams | undefined {
  const code = stringParam(search.code);
  const installationId = numberParam(search.installation_id);
  const state = stringParam(search.state);
  if (!code || installationId === undefined || !state) return undefined;
  const setupAction = stringParam(search.setup_action);
  return setupAction ? {code, installationId, state, setupAction} : {code, installationId, state};
}
function encodeCallbackQuery(params: GithubCallbackParams): string {
  const search = new URLSearchParams();
  search.set('code', params.code);
  search.set('installation_id', params.installationId.toString());
  search.set('state', params.state);
  if (params.setupAction) search.set('setup_action', params.setupAction);
  return search.toString();
}
function stringParam(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
function numberParam(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}
function githubCallbackErrorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Could not install GitHub.';
}
