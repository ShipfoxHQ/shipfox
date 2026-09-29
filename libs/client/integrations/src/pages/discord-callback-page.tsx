import {useAuthState, useRefreshAuth} from '@shipfox/client-auth';
import {useRouteSearch} from '@shipfox/client-shell/runtime';
import {createSingleFlight, sessionStorageOrUndefined} from '@shipfox/client-ui';
import {FullPageLoader} from '@shipfox/react-ui/loader';
import {toast} from '@shipfox/react-ui/toast';
import {useQueryClient} from '@tanstack/react-query';
import {useNavigate} from '@tanstack/react-router';
import {type Dispatch, type SetStateAction, useEffect, useMemo, useState} from 'react';
import {useCompleteIntegrationCallback} from '#application/complete-integration-callback.js';
import {CallbackStatusShell} from '#components/callback-status-shell.js';
import type {IntegrationConnection} from '#core/models.js';
import {
  clearDiscordInstallWorkspace,
  parseDiscordCallbackQuery,
  readDiscordInstallWorkspace,
  serializeDiscordCallbackQuery,
} from '#discord-callback.js';
import {classifyDiscordCallbackError, type DiscordCallbackFailure} from '#discord-form-errors.js';
import {useCompleteDiscordCallbackMutation} from '#hooks/api/integrations.js';
import {rememberCallbackKey, resolveWorkspaceSlug} from '#workspace-navigation.js';

const callbackRequests = createSingleFlight<string, IntegrationConnection>({
  maxTerminalResults: 32,
});
const completedCallbacks = new Set<string>();
const toastedCallbacks = new Set<string>();
type CompletedDiscordWorkspace = {slug?: string | undefined};

export function DiscordCallbackPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const refreshAuth = useRefreshAuth();
  const completeIntegrationCallback = useCompleteIntegrationCallback();
  const {mutateAsync: completeDiscordCallback} = useCompleteDiscordCallbackMutation();
  const {workspaces, isLoading} = useAuthState();
  const params = useRouteSearch(parseDiscordCallbackQuery);
  const workspaceId = useMemo(() => readDiscordInstallWorkspace(sessionStorageOrUndefined()), []);
  const [failure, setFailure] = useState<DiscordCallbackFailure | undefined>();
  const [completedWorkspace, setCompletedWorkspace] = useState<CompletedDiscordWorkspace>();

  useEffect(() => {
    if (!params || isLoading) return;

    let disposed = false;
    const key = serializeDiscordCallbackQuery(params);
    const request = callbackRequests.run(
      key,
      async () =>
        await completeIntegrationCallback({
          input: params,
          refreshAuth,
          complete: async (query, token) => await completeDiscordCallback({query, token}),
        }),
    );

    request.then(
      async (connection) =>
        await handleDiscordCallbackSuccess({
          connection,
          key,
          isDisposed: () => disposed,
          workspaces,
          queryClient,
          navigate,
          setCompletedWorkspace,
        }),
      (error: unknown) => {
        if (!disposed) setFailure(classifyDiscordCallbackError(error));
      },
    );

    return () => {
      disposed = true;
    };
  }, [
    completeIntegrationCallback,
    completeDiscordCallback,
    isLoading,
    navigate,
    params,
    queryClient,
    refreshAuth,
    workspaces,
  ]);

  if (!params) {
    return (
      <DiscordCallbackFailurePage
        failure={{
          title: 'Invalid Discord callback',
          message: 'Invalid Discord callback. Start the install again from workspace settings.',
          startOver: true,
          signIn: false,
        }}
        workspaceSlug={workspaces.find(({id}) => id === workspaceId)?.slug}
      />
    );
  }

  if (isLoading) return <FullPageLoader aria-label="Connecting Discord" />;

  if (completedWorkspace)
    return (
      <CallbackStatusShell
        title="Discord connected"
        status="success"
        message={
          completedWorkspace.slug
            ? 'Discord is connected. Continue in integrations settings.'
            : 'Discord is connected. Return to Shipfox to continue.'
        }
        workspaceSlug={completedWorkspace.slug}
        installPath="/w/$workspaceSlug/integrations/discord"
      />
    );

  if (failure)
    return (
      <DiscordCallbackFailurePage
        failure={failure}
        workspaceSlug={workspaces.find(({id}) => id === workspaceId)?.slug}
      />
    );

  return <FullPageLoader aria-label="Connecting Discord" />;
}

async function handleDiscordCallbackSuccess({
  connection,
  key,
  isDisposed,
  workspaces,
  queryClient,
  navigate,
  setCompletedWorkspace,
}: {
  connection: IntegrationConnection;
  key: string;
  isDisposed: () => boolean;
  workspaces: ReturnType<typeof useAuthState>['workspaces'];
  queryClient: ReturnType<typeof useQueryClient>;
  navigate: ReturnType<typeof useNavigate>;
  setCompletedWorkspace: Dispatch<SetStateAction<CompletedDiscordWorkspace | undefined>>;
}) {
  if (isDisposed()) return;
  if (completedCallbacks.has(key)) {
    await showResolvedDiscordWorkspace({
      connection,
      isDisposed,
      workspaces,
      queryClient,
      setCompletedWorkspace,
    });
    return;
  }
  rememberCallbackKey(completedCallbacks, key);
  try {
    clearDiscordInstallWorkspace(sessionStorageOrUndefined());
  } catch {
    // The successful API response remains the source of truth for navigation.
  }
  if (isDisposed()) return;
  if (!toastedCallbacks.has(key)) {
    rememberCallbackKey(toastedCallbacks, key);
    toast.success('Discord installed.');
  }
  await navigateToDiscordWorkspace({
    connection,
    isDisposed,
    workspaces,
    queryClient,
    navigate,
    setCompletedWorkspace,
  });
}

type DiscordWorkspaceResolution = {
  connection: IntegrationConnection;
  isDisposed: () => boolean;
  workspaces: ReturnType<typeof useAuthState>['workspaces'];
  queryClient: ReturnType<typeof useQueryClient>;
  setCompletedWorkspace: Dispatch<SetStateAction<CompletedDiscordWorkspace | undefined>>;
};

async function showResolvedDiscordWorkspace(params: DiscordWorkspaceResolution) {
  const workspaceSlug = await resolveWorkspaceSlug({
    workspaceId: params.connection.workspaceId,
    fallbackWorkspaces: params.workspaces,
    queryClient: params.queryClient,
  });
  if (!params.isDisposed()) {
    params.setCompletedWorkspace(workspaceSlug ? {slug: workspaceSlug} : {});
  }
}

async function navigateToDiscordWorkspace(
  params: DiscordWorkspaceResolution & {navigate: ReturnType<typeof useNavigate>},
) {
  let workspaceSlug: string | undefined;
  try {
    workspaceSlug = await resolveWorkspaceSlug({
      workspaceId: params.connection.workspaceId,
      fallbackWorkspaces: params.workspaces,
      queryClient: params.queryClient,
    });
    if (params.isDisposed()) return;
    if (!workspaceSlug) {
      params.setCompletedWorkspace({});
      return;
    }
    params.setCompletedWorkspace({slug: workspaceSlug});
    await params.navigate({
      to: '/w/$workspaceSlug/settings/integrations',
      params: {workspaceSlug},
      replace: true,
    });
  } catch {
    if (!params.isDisposed()) params.setCompletedWorkspace({slug: workspaceSlug});
  }
}

function DiscordCallbackFailurePage({
  failure,
  workspaceSlug,
}: {
  failure: DiscordCallbackFailure;
  workspaceSlug: string | undefined;
}) {
  return (
    <CallbackStatusShell
      title={failure.title}
      message={failure.message}
      startOver={failure.startOver}
      switchAccount={failure.signIn}
      workspaceSlug={workspaceSlug}
      installPath="/w/$workspaceSlug/integrations/discord"
      documentationUrl="https://docs.shipfox.io/integrations/discord/setup"
      documentationLabel="Read the Discord setup guide"
    />
  );
}
