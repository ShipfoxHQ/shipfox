import {ApiError} from '@shipfox/client-api';
import {useAuthState, useRefreshAuth} from '@shipfox/client-auth';
import {
  FocusedFrame,
  useClientAnalytics,
  userWorkspacesQueryKey,
} from '@shipfox/client-shell/runtime';
import {createSingleFlight, sessionStorageOrUndefined} from '@shipfox/client-ui';
import {Button, ButtonLink} from '@shipfox/react-ui/button';
import {Callout} from '@shipfox/react-ui/callout';
import {FullPageLoader} from '@shipfox/react-ui/loader';
import {toast} from '@shipfox/react-ui/toast';
import {Text} from '@shipfox/react-ui/typography';
import {useQueryClient} from '@tanstack/react-query';
import {Link, useNavigate} from '@tanstack/react-router';
import {useEffect, useMemo, useRef, useState} from 'react';
import {
  useCompleteIntegrationCallback,
  useResolveIntegrationWorkspaceSlug,
} from '#application/complete-integration-callback.js';
import type {IntegrationConnection} from '#core/models.js';
import {
  classifyGithubCallback,
  classifyGithubCallbackError,
  clearGithubInstallWorkspace,
  type GithubCallbackFailure,
  type GithubCallbackIntent,
  type GithubCallbackSearch,
  readGithubInstallWorkspace,
  serializeGithubCallback,
} from '#github-callback.js';
import {completeGithubCallback} from '#hooks/api/integrations.js';
import {rememberCallbackKey} from '#workspace-navigation.js';

const callbackRequests = createSingleFlight<string, IntegrationConnection>({
  maxTerminalResults: 32,
});
const capturedCompletions = new Set<string>();
const reportedFailures = new Set<string>();
const toastedCallbacks = new Set<string>();
type GithubOutcomeStatus = 'error' | 'info' | 'success' | 'warning';

export function GithubCallbackPage({search}: {search: GithubCallbackSearch}) {
  const auth = useAuthState();
  const analytics = useClientAnalytics();
  const completeIntegrationCallback = useCompleteIntegrationCallback();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const refreshAuth = useRefreshAuth();
  const resolveIntegrationWorkspaceSlug = useResolveIntegrationWorkspaceSlug();
  const intent = useMemo(() => classifyGithubCallback(search), [search]);
  const storedWorkspaceId = useMemo(
    () => readGithubInstallWorkspace(sessionStorageOrUndefined()),
    [],
  );
  const storedWorkspace = auth.workspaces.find(({id}) => id === storedWorkspaceId);
  const [failure, setFailure] = useState<GithubCallbackFailure>();
  const [completedWorkspaceId, setCompletedWorkspaceId] = useState<string>();
  const capturedViews = useRef(new Set<string>());
  const membershipHydrationFailed =
    auth.isAuthenticated &&
    !auth.hasWorkspace &&
    queryClient.getQueryState(userWorkspacesQueryKey)?.status === 'error';

  useEffect(() => {
    if (auth.isLoading) return;
    if (!auth.isAuthenticated) {
      captureViewOnce(
        capturedViews.current,
        analytics,
        `guest:${intent.kind}`,
        'github_callback_guest_viewed',
        {
          outcome: intent.kind,
        },
      );
      return;
    }
    if (membershipHydrationFailed) return;
    if (intent.kind !== 'request') return;
    captureViewOnce(
      capturedViews.current,
      analytics,
      `request:${storedWorkspace?.id ?? (auth.hasWorkspace ? 'member' : 'none')}`,
      'github_install_request_viewed',
      {
        viewer: auth.hasWorkspace ? 'member' : 'no_membership',
        ...(storedWorkspace ? {workspace_id: storedWorkspace.id} : {}),
      },
    );
  }, [
    analytics,
    auth.hasWorkspace,
    auth.isAuthenticated,
    auth.isLoading,
    intent.kind,
    membershipHydrationFailed,
    storedWorkspace,
  ]);

  const isTerminalWithoutApi =
    !membershipHydrationFailed &&
    (intent.kind !== 'complete' ||
      (!auth.isLoading && (!auth.isAuthenticated || !auth.hasWorkspace)));
  useEffect(() => {
    if (!isTerminalWithoutApi) return;
    clearGithubInstallWorkspace(sessionStorageOrUndefined());
  }, [isTerminalWithoutApi]);

  useEffect(() => {
    if (
      intent.kind !== 'complete' ||
      auth.isLoading ||
      !auth.isAuthenticated ||
      !auth.hasWorkspace ||
      completedWorkspaceId
    ) {
      return;
    }

    let active = true;
    const callbackKey = serializeGithubCallback(intent.params);
    const request = callbackRequests.run(
      callbackKey,
      async () =>
        await completeIntegrationCallback({
          input: intent.params,
          refreshAuth,
          complete: async (input, token) => await completeGithubCallback({...input, token}),
        }),
    );

    request.then(
      async (connection) =>
        await handleGithubCallbackSuccess({
          connection,
          callbackKey,
          analytics,
          workspaces: auth.workspaces,
          resolveIntegrationWorkspaceSlug,
          navigate,
          isActive: () => active,
          setCompletedWorkspaceId,
        }),
      (error: unknown) => {
        clearGithubInstallWorkspace(sessionStorageOrUndefined());
        if (!active) return;
        const classified = classifyGithubCallbackError(error);
        const shouldReport = !(error instanceof ApiError) || error.code === 'network-error';
        if (shouldReport && !reportedFailures.has(callbackKey)) {
          rememberCallbackKey(reportedFailures, callbackKey);
          globalThis.reportError?.(new Error('Failed to complete the GitHub callback.'));
        }
        setFailure((previous) => (previous?.kind === classified.kind ? previous : classified));
      },
    );

    return () => {
      active = false;
    };
  }, [
    analytics,
    auth.hasWorkspace,
    auth.isAuthenticated,
    auth.isLoading,
    auth.workspaces,
    completeIntegrationCallback,
    completedWorkspaceId,
    intent,
    navigate,
    refreshAuth,
    resolveIntegrationWorkspaceSlug,
  ]);

  if (auth.isLoading) return <FullPageLoader aria-label="Loading GitHub callback" />;

  if (!auth.isAuthenticated) {
    return <GuestOutcome intent={intent} />;
  }

  if (membershipHydrationFailed) {
    return <MembershipUnavailableOutcome refreshAuth={refreshAuth} />;
  }

  if (!auth.hasWorkspace) {
    return <NoMembershipOutcome />;
  }

  if (intent.kind === 'request') {
    return <RequestOutcome />;
  }

  if (intent.kind === 'provider-error') {
    return (
      <GithubOutcome
        title="GitHub did not complete installation"
        message="No connection was changed. Go to Shipfox to start the installation again."
        status="warning"
      >
        <ShipfoxHomeAction />
      </GithubOutcome>
    );
  }

  if (intent.kind === 'invalid') {
    return (
      <GithubOutcome
        title="Invalid GitHub callback"
        message="This link is missing required callback information. Go to Shipfox to start the installation again."
        status="error"
      >
        <ShipfoxHomeAction />
      </GithubOutcome>
    );
  }

  if (completedWorkspaceId) {
    return (
      <GithubOutcome
        title="GitHub installed"
        message="The connection is ready. Go to Shipfox to continue."
        status="success"
      >
        <ShipfoxHomeAction />
      </GithubOutcome>
    );
  }

  if (failure) {
    const outcome = failureCopy(failure);
    return (
      <GithubOutcome title={outcome.title} message={outcome.message} status={outcome.status}>
        <ShipfoxHomeAction />
      </GithubOutcome>
    );
  }

  return <FullPageLoader aria-label="Connecting GitHub" />;
}

async function handleGithubCallbackSuccess({
  connection,
  callbackKey,
  analytics,
  workspaces,
  resolveIntegrationWorkspaceSlug,
  navigate,
  isActive,
  setCompletedWorkspaceId,
}: {
  connection: IntegrationConnection;
  callbackKey: string;
  analytics: ReturnType<typeof useClientAnalytics>;
  workspaces: ReturnType<typeof useAuthState>['workspaces'];
  resolveIntegrationWorkspaceSlug: ReturnType<typeof useResolveIntegrationWorkspaceSlug>;
  navigate: ReturnType<typeof useNavigate>;
  isActive: () => boolean;
  setCompletedWorkspaceId: (workspaceId: string) => void;
}) {
  clearGithubInstallWorkspace(sessionStorageOrUndefined());
  if (!capturedCompletions.has(callbackKey)) {
    rememberCallbackKey(capturedCompletions, callbackKey);
    analytics.capture('github_connection_completed', {workspace_id: connection.workspaceId});
  }
  if (!isActive()) return;
  const workspaceSlug = await resolveIntegrationWorkspaceSlug({
    workspaceId: connection.workspaceId,
    fallbackWorkspaces: workspaces,
  });
  if (!isActive()) return;
  if (!workspaceSlug) {
    setCompletedWorkspaceId(connection.workspaceId);
    return;
  }
  if (!toastedCallbacks.has(callbackKey)) {
    rememberCallbackKey(toastedCallbacks, callbackKey);
    toast.success('GitHub installed.');
  }
  try {
    await navigate({
      to: '/w/$workspaceSlug/settings/integrations',
      params: {workspaceSlug},
      replace: true,
    });
  } catch {
    if (isActive()) setCompletedWorkspaceId(connection.workspaceId);
  }
}

function RequestOutcome() {
  return (
    <GithubOutcome
      title="GitHub approval requested"
      message="GitHub sent the request to your organization's administrators. No Shipfox connection was created yet. Go to Shipfox to continue."
      status="info"
    >
      <ShipfoxHomeAction />
    </GithubOutcome>
  );
}

function GuestOutcome({intent}: {intent: GithubCallbackIntent}) {
  const outcome = guestOutcomeCopy(intent);
  return (
    <GithubOutcome title={outcome.title} message={outcome.message} status={outcome.status}>
      <ShipfoxHomeAction />
    </GithubOutcome>
  );
}

function guestOutcomeCopy(intent: GithubCallbackIntent): {
  title: string;
  message: string;
  status: GithubOutcomeStatus;
} {
  if (intent.kind === 'provider-error') {
    return {
      title: 'GitHub did not complete the request',
      message:
        'No connection was changed. Let the person setting it up know that GitHub did not complete the request.',
      status: 'warning',
    };
  }
  if (intent.kind === 'invalid') {
    return {
      title: 'This GitHub request cannot be completed',
      message:
        'This link is missing required information. Ask the person who sent you here to start the GitHub connection again.',
      status: 'error',
    };
  }
  return {
    title: 'GitHub request approved',
    message:
      'Let the person who asked you to approve Shipfox know. They can now continue setup in Shipfox.',
    status: 'info',
  };
}

function ShipfoxHomeAction() {
  return (
    <ButtonLink asChild className="min-h-44 w-full sm:w-fit">
      <Link to="/">Go to Shipfox</Link>
    </ButtonLink>
  );
}

function NoMembershipOutcome() {
  return (
    <GithubOutcome
      title="You can return to your teammate"
      message="This account is not a member of a Shipfox workspace. Ask your teammate for an invitation if they need you to finish the connection."
      status="info"
    >
      <ShipfoxHomeAction />
    </GithubOutcome>
  );
}

function MembershipUnavailableOutcome({
  refreshAuth,
}: {
  refreshAuth: ReturnType<typeof useRefreshAuth>;
}) {
  return (
    <GithubOutcome
      title="Could not load your workspaces"
      message="Shipfox could not verify your workspace memberships. Check your connection and try again."
      status="warning"
    >
      <div className="flex flex-col gap-inline sm:flex-row">
        <Button
          className="min-h-44 w-full sm:w-fit"
          onClick={() => void refreshAuth().catch(() => undefined)}
        >
          Try again
        </Button>
        <ButtonLink asChild variant="muted" className="min-h-44 w-full sm:w-fit">
          <Link to="/">Go to Shipfox</Link>
        </ButtonLink>
      </div>
    </GithubOutcome>
  );
}

function GithubOutcome({
  title,
  message,
  status,
  children,
}: {
  title: string;
  message: string;
  status: GithubOutcomeStatus;
  children: React.ReactNode;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => headingRef.current?.focus(), []);
  return (
    <main className="flex min-h-screen px-frame py-frame">
      <FocusedFrame className="flex flex-col justify-center gap-section">
        <h1 ref={headingRef} tabIndex={-1} className="text-2xl font-semibold outline-none">
          {title}
        </h1>
        <Callout role={status === 'error' ? 'alert' : 'status'} type={status}>
          <Text size="sm">{message}</Text>
        </Callout>
        {children}
      </FocusedFrame>
    </main>
  );
}

function failureCopy(failure: GithubCallbackFailure): {
  title: string;
  message: string;
  status: 'error' | 'warning';
} {
  switch (failure.kind) {
    case 'expired':
      return {
        title: 'GitHub callback expired',
        message:
          'This installation link has expired. Go to Shipfox to start the installation again.',
        status: 'warning',
      };
    case 'invalid':
      return {
        title: 'Invalid GitHub callback',
        message: 'Shipfox could not verify this installation link. Go to Shipfox to start again.',
        status: 'error',
      };
    case 'actor-mismatch':
      return {
        title: 'This GitHub connection cannot be completed',
        message:
          'It was started with a different Shipfox account. Go to Shipfox and start the connection again.',
        status: 'warning',
      };
    case 'workspace-access-changed':
      return {
        title: 'Workspace access changed',
        message:
          'Your Shipfox account no longer has access to the workspace that started this installation. Go to Shipfox to continue, or ask a teammate to restore your access.',
        status: 'warning',
      };
    case 'not-authorized':
      return {
        title: 'GitHub access could not be verified',
        message:
          'This account cannot connect the selected GitHub installation. Go to Shipfox to try another installation.',
        status: 'warning',
      };
    case 'already-linked':
      return {
        title: 'GitHub is already connected elsewhere',
        message:
          'This GitHub installation cannot be moved from another workspace. Go to Shipfox to choose another installation.',
        status: 'warning',
      };
    case 'provider-error':
      return {
        title: 'GitHub is temporarily unavailable',
        message: 'The connection was not completed. Go to Shipfox to start the installation again.',
        status: 'warning',
      };
    case 'unknown':
      return {
        title: 'Could not connect GitHub',
        message: 'The connection was not completed. Go to Shipfox to start the installation again.',
        status: 'error',
      };
  }
}

function captureViewOnce(
  captured: Set<string>,
  analytics: ReturnType<typeof useClientAnalytics>,
  key: string,
  event: string,
  properties: Record<string, unknown>,
) {
  if (captured.has(key)) return;
  captured.add(key);
  analytics.capture(event, properties);
}
