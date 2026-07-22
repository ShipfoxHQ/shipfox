import {useRefreshAuth} from '@shipfox/client-auth';
import {createSingleFlight} from '@shipfox/client-ui';
import {FullPageLoader} from '@shipfox/react-ui/loader';
import {toast} from '@shipfox/react-ui/toast';
import {useQueryClient} from '@tanstack/react-query';
import {useNavigate, useSearch} from '@tanstack/react-router';
import {useEffect, useMemo, useState} from 'react';
import {CallbackStatusShell} from '#components/callback-status-shell.js';
import type {IntegrationConnection} from '#core/models.js';
import {integrationsQueryKeys, useCompleteLinearCallbackMutation} from '#hooks/api/integrations.js';
import {
  classifyLinearCallbackError,
  clearLinearInstallWorkspace,
  type LinearCallbackFailure,
  parseLinearCallbackQuery,
  readLinearInstallWorkspace,
  serializeLinearCallbackQuery,
} from '#linear-callback.js';

// Retain only recent completions: this bounds long-lived callback pages while
// still covering StrictMode and immediate Back/Forward remounts.
const callbackRequests = createSingleFlight<string, IntegrationConnection>({
  maxTerminalResults: 32,
});
// Keeps the success toast firing once per distinct callback even though the
// effect re-runs against the cached request as the mutation identity churns.
const toastedCallbacks = new Set<string>();

export function LinearCallbackPage() {
  const search = useSearch({strict: false});
  const navigate = useNavigate();
  const refreshAuth = useRefreshAuth();
  const queryClient = useQueryClient();
  const {mutateAsync: completeLinearCallback} = useCompleteLinearCallbackMutation();
  const params = useMemo(() => parseLinearCallbackQuery(search), [search]);
  const workspaceId = useMemo(() => {
    try {
      return readLinearInstallWorkspace(window.sessionStorage);
    } catch {
      return undefined;
    }
  }, []);
  const [failure, setFailure] = useState<LinearCallbackFailure | undefined>();
  useEffect(() => {
    if (!params) return;

    let disposed = false;
    const key = serializeLinearCallbackQuery(params);
    const request = callbackRequests.run(
      key,
      async () =>
        await refreshAuth().then(
          async (session) =>
            await completeLinearCallback({query: params, token: session.accessToken}),
        ),
    );

    request.then(
      async (connection) => {
        if (disposed) return;
        try {
          clearLinearInstallWorkspace(window.sessionStorage);
        } catch {
          // The successful API response remains the source of truth for navigation.
        }
        try {
          await queryClient.invalidateQueries({
            queryKey: integrationsQueryKeys.connectionsByWorkspace(connection.workspaceId),
          });
        } catch {
          // Cache refresh is best effort: the successful callback is already committed server-side.
        }
        if (disposed) return;
        if (!toastedCallbacks.has(key)) {
          toastedCallbacks.add(key);
          toast.success('Linear installed.');
        }
        try {
          await navigate({
            to: '/workspaces/$wid/settings/integrations',
            params: {wid: connection.workspaceId},
            replace: true,
          });
        } catch {
          // Keep the completed callback page visible if client navigation is interrupted.
        }
      },
      (error: unknown) => {
        if (disposed) return;
        setFailure(classifyLinearCallbackError(error));
      },
    );

    return () => {
      disposed = true;
    };
  }, [completeLinearCallback, navigate, params, queryClient, refreshAuth]);

  if (!params) {
    return (
      <LinearCallbackFailurePage
        failure={{
          title: 'Invalid Linear callback',
          message: 'Invalid Linear callback. Start the install again from workspace settings.',
          startOver: true,
          signIn: false,
        }}
        workspaceId={workspaceId}
      />
    );
  }

  if (!failure) return <FullPageLoader aria-label="Connecting Linear" />;

  return <LinearCallbackFailurePage failure={failure} workspaceId={workspaceId} />;
}

function LinearCallbackFailurePage({
  failure,
  workspaceId,
}: {
  failure: LinearCallbackFailure;
  workspaceId: string | undefined;
}) {
  return (
    <CallbackStatusShell
      title={failure.title ?? 'Linear install could not be completed'}
      message={failure.message}
      startOver={failure.startOver}
      switchAccount={failure.signIn}
      workspaceId={workspaceId}
      installPath="/workspaces/$wid/integrations/linear"
    />
  );
}
