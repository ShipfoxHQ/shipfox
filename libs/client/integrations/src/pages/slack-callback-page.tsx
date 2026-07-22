import {useRefreshAuth} from '@shipfox/client-auth';
import {createSingleFlight} from '@shipfox/client-ui';
import {FullPageLoader} from '@shipfox/react-ui/loader';
import {toast} from '@shipfox/react-ui/toast';
import {useQueryClient} from '@tanstack/react-query';
import {useNavigate, useSearch} from '@tanstack/react-router';
import {useEffect, useMemo, useState} from 'react';
import {CallbackStatusShell} from '#components/callback-status-shell.js';
import type {IntegrationConnection} from '#core/models.js';
import {integrationsQueryKeys, useCompleteSlackCallbackMutation} from '#hooks/api/integrations.js';
import {
  classifySlackCallbackError,
  clearSlackInstallWorkspace,
  parseSlackCallbackQuery,
  readSlackInstallWorkspace,
  type SlackCallbackFailure,
  serializeSlackCallbackQuery,
} from '#slack-callback.js';

// Retain only recent completions: this bounds long-lived callback pages while
// still covering StrictMode and immediate Back/Forward remounts.
const callbackRequests = createSingleFlight<string, IntegrationConnection>({
  maxTerminalResults: 32,
});
const completedCallbacks = new Set<string>();
const toastedCallbacks = new Set<string>();

export function SlackCallbackPage() {
  const search = useSearch({strict: false});
  const navigate = useNavigate();
  const refreshAuth = useRefreshAuth();
  const queryClient = useQueryClient();
  const {mutateAsync: completeSlackCallback} = useCompleteSlackCallbackMutation();
  const params = useMemo(() => parseSlackCallbackQuery(search), [search]);
  const workspaceId = useMemo(() => readSlackInstallWorkspace(window.sessionStorage), []);
  const [failure, setFailure] = useState<SlackCallbackFailure>();
  const [completedWorkspaceId, setCompletedWorkspaceId] = useState<string>();

  useEffect(() => {
    if (!params) return;
    let disposed = false;
    const key = serializeSlackCallbackQuery(params);
    const request = callbackRequests.run(
      key,
      async () =>
        await refreshAuth().then(
          async (session) =>
            await completeSlackCallback({query: params, token: session.accessToken}),
        ),
    );
    request.then(
      async (connection) => {
        if (disposed) return;
        if (completedCallbacks.has(key)) {
          setCompletedWorkspaceId(connection.workspaceId);
          return;
        }
        completedCallbacks.add(key);
        try {
          clearSlackInstallWorkspace(window.sessionStorage);
        } catch {
          // The successful API response remains the source of truth.
        }
        try {
          await queryClient.invalidateQueries({
            queryKey: integrationsQueryKeys.connectionsByWorkspace(connection.workspaceId),
          });
        } catch {
          // Navigation can continue when cache refresh is unavailable.
        }
        if (disposed) return;
        if (!toastedCallbacks.has(key)) {
          toastedCallbacks.add(key);
          toast.success('Slack installed.');
        }
        try {
          await navigate({
            to: '/workspaces/$wid/settings/integrations',
            params: {wid: connection.workspaceId},
            replace: true,
          });
        } catch {
          if (!disposed) setCompletedWorkspaceId(connection.workspaceId);
        }
      },
      (error: unknown) => {
        if (!disposed) setFailure(classifySlackCallbackError(error));
      },
    );
    return () => {
      disposed = true;
    };
  }, [completeSlackCallback, navigate, params, queryClient, refreshAuth]);

  if (!params)
    return (
      <CallbackStatusShell
        title="Invalid Slack callback"
        message="This Slack link is missing required parameters. Start the install again from workspace settings."
        startOver
        workspaceId={workspaceId}
        installPath="/workspaces/$wid/integrations/slack"
      />
    );
  if (completedWorkspaceId)
    return (
      <CallbackStatusShell
        title="Slack connected"
        message="Slack is connected. Continue in integrations settings."
        workspaceId={completedWorkspaceId}
        installPath="/workspaces/$wid/integrations/slack"
      />
    );
  if (failure)
    return (
      <CallbackStatusShell
        {...failure}
        workspaceId={workspaceId}
        switchAccount={failure.signIn}
        installPath="/workspaces/$wid/integrations/slack"
      />
    );
  return <FullPageLoader aria-label="Connecting Slack" />;
}
