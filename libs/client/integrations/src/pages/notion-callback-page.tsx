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
import {useCompleteNotionCallbackMutation} from '#hooks/api/integrations.js';
import {
  clearNotionInstallWorkspace,
  parseNotionCallbackQuery,
  readNotionInstallWorkspace,
  serializeNotionCallbackQuery,
} from '#notion-callback.js';
import {classifyNotionCallbackError, type NotionCallbackFailure} from '#notion-form-errors.js';
import {rememberCallbackKey, resolveWorkspaceSlug} from '#workspace-navigation.js';

const callbackRequests = createSingleFlight<string, IntegrationConnection>({
  maxTerminalResults: 32,
});
const completedCallbacks = new Set<string>();
const toastedCallbacks = new Set<string>();
type CompletedNotionWorkspace = {slug?: string | undefined};

export function NotionCallbackPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const refreshAuth = useRefreshAuth();
  const completeIntegrationCallback = useCompleteIntegrationCallback();
  const {mutateAsync: completeNotionCallback} = useCompleteNotionCallbackMutation();
  const {workspaces, isLoading} = useAuthState();
  const params = useRouteSearch(parseNotionCallbackQuery);
  const workspaceId = useMemo(() => readNotionInstallWorkspace(sessionStorageOrUndefined()), []);
  const [failure, setFailure] = useState<NotionCallbackFailure | undefined>();
  const [completedWorkspace, setCompletedWorkspace] = useState<CompletedNotionWorkspace>();

  useEffect(() => {
    if (!params || isLoading) return;

    let disposed = false;
    const key = serializeNotionCallbackQuery(params);
    const request = callbackRequests.run(
      key,
      async () =>
        await completeIntegrationCallback({
          input: params,
          refreshAuth,
          complete: async (query, token) => await completeNotionCallback({query, token}),
        }),
    );

    request.then(
      async (connection) =>
        await handleNotionCallbackSuccess({
          connection,
          key,
          isDisposed: () => disposed,
          workspaces,
          queryClient,
          navigate,
          setCompletedWorkspace,
        }),
      (error: unknown) => {
        if (!disposed) setFailure(classifyNotionCallbackError(error));
      },
    );

    return () => {
      disposed = true;
    };
  }, [
    completeIntegrationCallback,
    completeNotionCallback,
    isLoading,
    navigate,
    params,
    queryClient,
    refreshAuth,
    workspaces,
  ]);

  if (!params) {
    return (
      <NotionCallbackFailurePage
        failure={{
          title: 'Invalid Notion callback',
          message: 'Invalid Notion callback. Start the install again from workspace settings.',
          startOver: true,
          signIn: false,
        }}
        workspaceSlug={workspaces.find(({id}) => id === workspaceId)?.slug}
      />
    );
  }

  if (isLoading) return <FullPageLoader aria-label="Connecting Notion" />;

  if (completedWorkspace)
    return (
      <CallbackStatusShell
        title="Notion connected"
        status="success"
        message={
          completedWorkspace.slug
            ? 'Notion is connected. Continue in integrations settings.'
            : 'Notion is connected. Return to Shipfox to continue.'
        }
        workspaceSlug={completedWorkspace.slug}
        installPath="/w/$workspaceSlug/integrations/notion"
      />
    );

  if (failure)
    return (
      <NotionCallbackFailurePage
        failure={failure}
        workspaceSlug={workspaces.find(({id}) => id === workspaceId)?.slug}
      />
    );

  return <FullPageLoader aria-label="Connecting Notion" />;
}

async function handleNotionCallbackSuccess({
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
  setCompletedWorkspace: Dispatch<SetStateAction<CompletedNotionWorkspace | undefined>>;
}) {
  if (isDisposed()) return;
  if (completedCallbacks.has(key)) {
    await showResolvedNotionWorkspace({
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
    clearNotionInstallWorkspace(sessionStorageOrUndefined());
  } catch {
    // The successful API response remains the source of truth for navigation.
  }
  if (isDisposed()) return;
  if (!toastedCallbacks.has(key)) {
    rememberCallbackKey(toastedCallbacks, key);
    toast.success('Notion installed.');
  }
  await navigateToNotionWorkspace({
    connection,
    isDisposed,
    workspaces,
    queryClient,
    navigate,
    setCompletedWorkspace,
  });
}

type NotionWorkspaceResolution = {
  connection: IntegrationConnection;
  isDisposed: () => boolean;
  workspaces: ReturnType<typeof useAuthState>['workspaces'];
  queryClient: ReturnType<typeof useQueryClient>;
  setCompletedWorkspace: Dispatch<SetStateAction<CompletedNotionWorkspace | undefined>>;
};

async function showResolvedNotionWorkspace(params: NotionWorkspaceResolution) {
  const workspaceSlug = await resolveWorkspaceSlug({
    workspaceId: params.connection.workspaceId,
    fallbackWorkspaces: params.workspaces,
    queryClient: params.queryClient,
  });
  if (!params.isDisposed()) {
    params.setCompletedWorkspace(workspaceSlug ? {slug: workspaceSlug} : {});
  }
}

async function navigateToNotionWorkspace(
  params: NotionWorkspaceResolution & {navigate: ReturnType<typeof useNavigate>},
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

function NotionCallbackFailurePage({
  failure,
  workspaceSlug,
}: {
  failure: NotionCallbackFailure;
  workspaceSlug: string | undefined;
}) {
  return (
    <CallbackStatusShell
      title={failure.title}
      message={failure.message}
      startOver={failure.startOver}
      switchAccount={failure.signIn}
      workspaceSlug={workspaceSlug}
      installPath="/w/$workspaceSlug/integrations/notion"
      documentationUrl="https://docs.shipfox.io/integrations/notion/setup"
    />
  );
}
