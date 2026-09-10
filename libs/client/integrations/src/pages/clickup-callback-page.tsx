import {useAuthState, useRefreshAuth} from '@shipfox/client-auth';
import {useRouteSearch} from '@shipfox/client-shell/runtime';
import {createSingleFlight, sessionStorageOrUndefined} from '@shipfox/client-ui';
import {FullPageLoader} from '@shipfox/react-ui/loader';
import {toast} from '@shipfox/react-ui/toast';
import {useQueryClient} from '@tanstack/react-query';
import {useNavigate} from '@tanstack/react-router';
import {type Dispatch, type SetStateAction, useEffect, useMemo, useState} from 'react';
import {useCompleteIntegrationCallback} from '#application/complete-integration-callback.js';
import {
  clearClickUpInstallWorkspace,
  parseClickUpCallbackQuery,
  readClickUpInstallWorkspace,
  serializeClickUpCallbackQuery,
} from '#clickup-callback.js';
import {type ClickUpCallbackFailure, classifyClickUpCallbackError} from '#clickup-form-errors.js';
import {CallbackStatusShell} from '#components/callback-status-shell.js';
import type {IntegrationConnection} from '#core/models.js';
import {useCompleteClickUpCallbackMutation} from '#hooks/api/integrations.js';
import {rememberCallbackKey, resolveWorkspaceSlug} from '#workspace-navigation.js';

const callbackRequests = createSingleFlight<string, IntegrationConnection>({
  maxTerminalResults: 32,
});
const completedCallbacks = new Set<string>();
const toastedCallbacks = new Set<string>();
type CompletedClickUpWorkspace = {slug?: string | undefined};

export function ClickUpCallbackPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const refreshAuth = useRefreshAuth();
  const completeIntegrationCallback = useCompleteIntegrationCallback();
  const {mutateAsync: completeClickUpCallback} = useCompleteClickUpCallbackMutation();
  const {workspaces, isLoading} = useAuthState();
  const params = useRouteSearch(parseClickUpCallbackQuery);
  const workspaceId = useMemo(() => readClickUpInstallWorkspace(sessionStorageOrUndefined()), []);
  const [failure, setFailure] = useState<ClickUpCallbackFailure | undefined>();
  const [completedWorkspace, setCompletedWorkspace] = useState<CompletedClickUpWorkspace>();

  useEffect(() => {
    if (!params || isLoading) return;

    let disposed = false;
    const key = serializeClickUpCallbackQuery(params);
    const request = callbackRequests.run(
      key,
      async () =>
        await completeIntegrationCallback({
          input: params,
          refreshAuth,
          complete: async (query, token) => await completeClickUpCallback({query, token}),
        }),
    );

    request.then(
      async (connection) =>
        await handleClickUpCallbackSuccess({
          connection,
          key,
          isDisposed: () => disposed,
          workspaces,
          queryClient,
          navigate,
          setCompletedWorkspace,
        }),
      (error: unknown) => {
        if (!disposed) setFailure(classifyClickUpCallbackError(error));
      },
    );

    return () => {
      disposed = true;
    };
  }, [
    completeIntegrationCallback,
    completeClickUpCallback,
    isLoading,
    navigate,
    params,
    queryClient,
    refreshAuth,
    workspaces,
  ]);

  if (!params) {
    return (
      <ClickUpCallbackFailurePage
        failure={{
          title: 'Invalid ClickUp callback',
          message: 'Invalid ClickUp callback. Start the install again from workspace settings.',
          startOver: true,
          signIn: false,
        }}
        workspaceSlug={workspaces.find(({id}) => id === workspaceId)?.slug}
      />
    );
  }

  if (isLoading) return <FullPageLoader aria-label="Connecting ClickUp" />;

  if (completedWorkspace)
    return (
      <CallbackStatusShell
        title="ClickUp connected"
        status="success"
        message={
          completedWorkspace.slug
            ? 'ClickUp is connected. Continue in integrations settings.'
            : 'ClickUp is connected. Return to Shipfox to continue.'
        }
        workspaceSlug={completedWorkspace.slug}
        installPath="/w/$workspaceSlug/integrations/clickup"
      />
    );

  if (failure)
    return (
      <ClickUpCallbackFailurePage
        failure={failure}
        workspaceSlug={workspaces.find(({id}) => id === workspaceId)?.slug}
      />
    );

  return <FullPageLoader aria-label="Connecting ClickUp" />;
}

async function handleClickUpCallbackSuccess({
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
  setCompletedWorkspace: Dispatch<SetStateAction<CompletedClickUpWorkspace | undefined>>;
}) {
  if (isDisposed()) return;
  if (completedCallbacks.has(key)) {
    await showResolvedClickUpWorkspace({
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
    clearClickUpInstallWorkspace(sessionStorageOrUndefined());
  } catch {
    // The successful API response remains the source of truth for navigation.
  }
  if (isDisposed()) return;
  if (!toastedCallbacks.has(key)) {
    rememberCallbackKey(toastedCallbacks, key);
    toast.success('ClickUp installed.');
  }
  await navigateToClickUpWorkspace({
    connection,
    isDisposed,
    workspaces,
    queryClient,
    navigate,
    setCompletedWorkspace,
  });
}

type ClickUpWorkspaceResolution = {
  connection: IntegrationConnection;
  isDisposed: () => boolean;
  workspaces: ReturnType<typeof useAuthState>['workspaces'];
  queryClient: ReturnType<typeof useQueryClient>;
  setCompletedWorkspace: Dispatch<SetStateAction<CompletedClickUpWorkspace | undefined>>;
};

async function showResolvedClickUpWorkspace(params: ClickUpWorkspaceResolution) {
  const workspaceSlug = await resolveWorkspaceSlug({
    workspaceId: params.connection.workspaceId,
    fallbackWorkspaces: params.workspaces,
    queryClient: params.queryClient,
  });
  if (!params.isDisposed()) {
    params.setCompletedWorkspace(workspaceSlug ? {slug: workspaceSlug} : {});
  }
}

async function navigateToClickUpWorkspace(
  params: ClickUpWorkspaceResolution & {navigate: ReturnType<typeof useNavigate>},
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

function ClickUpCallbackFailurePage({
  failure,
  workspaceSlug,
}: {
  failure: ClickUpCallbackFailure;
  workspaceSlug: string | undefined;
}) {
  return (
    <CallbackStatusShell
      title={failure.title}
      message={failure.message}
      startOver={failure.startOver}
      switchAccount={failure.signIn}
      workspaceSlug={workspaceSlug}
      installPath="/w/$workspaceSlug/integrations/clickup"
    />
  );
}
