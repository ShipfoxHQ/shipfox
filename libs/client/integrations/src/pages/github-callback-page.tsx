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
        if (!active) return;
        const classified = classifyGithubCallbackError(error);
        const shouldReport = !(error instanceof ApiError) || error.code === 'network-error';
        if (shouldReport && !reportedFailures.has(callbackKey)) {
          rememberCallbackKey(reportedFailures, callbackKey);
          globalThis.reportError?.(new Error('Failed to complete the GitHub callback.'));
        }
        clearGithubInstallWorkspace(sessionStorageOrUndefined());
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
    return <GuestOutcome />;
  }

  if (membershipHydrationFailed) {
    return <MembershipUnavailableOutcome refreshAuth={refreshAuth} />;
  }

  if (!auth.hasWorkspace) {
    return <NoMembershipOutcome />;
  }

  if (intent.kind === 'request') {
    return <RequestOutcome storedWorkspace={storedWorkspace} workspaces={auth.workspaces} />;
  }

  if (intent.kind === 'provider-error') {
    return (
      <GithubOutcome
        title="GitHub did not complete installation"
        message="No connection was changed. Return to a member workspace to start the installation again."
        status="warning"
      >
        <MemberWorkspaceActions workspaces={auth.workspaces} />
      </GithubOutcome>
    );
  }

  if (intent.kind === 'invalid') {
    return (
      <GithubOutcome
        title="Invalid GitHub callback"
        message="This link is missing required callback information. Start the installation again from a member workspace."
        status="error"
      >
        <MemberWorkspaceActions workspaces={auth.workspaces} />
      </GithubOutcome>
    );
  }

  if (completedWorkspaceId) {
    return (
      <GithubOutcome
        title="GitHub installed"
        message="The connection is ready. Open a member workspace to continue."
        status="success"
      >
        <MemberWorkspaceActions workspaces={auth.workspaces} />
      </GithubOutcome>
    );
  }

  if (failure) {
    const outcome = failureCopy(failure);
    return (
      <GithubOutcome title={outcome.title} message={outcome.message} status={outcome.status}>
        <MemberWorkspaceActions workspaces={auth.workspaces} />
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

function RequestOutcome({
  storedWorkspace,
  workspaces,
}: {
  storedWorkspace: ReturnType<typeof useAuthState>['workspaces'][number] | undefined;
  workspaces: ReturnType<typeof useAuthState>['workspaces'];
}) {
  return (
    <GithubOutcome
      title="Approval requested on GitHub"
      message="A GitHub administrator can approve the request without a Shipfox account. Return to your workspace, or invite a teammate if they also need to finish setup."
      status="info"
    >
      {storedWorkspace ? (
        <div className="flex flex-col gap-inline sm:flex-row">
          <ButtonLink asChild className="min-h-44 w-full sm:w-fit">
            <Link
              to="/w/$workspaceSlug/integrations"
              params={{workspaceSlug: storedWorkspace.slug}}
            >
              Return to workspace
            </Link>
          </ButtonLink>
          <ButtonLink asChild variant="muted" className="min-h-44 w-full sm:w-fit">
            <Link
              to="/w/$workspaceSlug/settings/members"
              params={{workspaceSlug: storedWorkspace.slug}}
            >
              Invite a teammate
            </Link>
          </ButtonLink>
        </div>
      ) : (
        <MemberWorkspaceActions workspaces={workspaces} />
      )}
    </GithubOutcome>
  );
}

function GuestOutcome() {
  return (
    <GithubOutcome
      title="You can return to your teammate"
      message="If you approved Shipfox in GitHub, let the person setting it up know. You do not need a Shipfox account just to approve GitHub access."
      status="info"
    >
      <ButtonLink asChild variant="muted" className="min-h-44 w-full sm:w-fit">
        <Link to="/">Back to Shipfox</Link>
      </ButtonLink>
    </GithubOutcome>
  );
}

function NoMembershipOutcome() {
  return (
    <GithubOutcome
      title="You can return to your teammate"
      message="This account is not a member of a Shipfox workspace. Ask your teammate for an invitation if they need you to finish the connection."
      status="info"
    >
      <ButtonLink asChild variant="muted" className="min-h-44 w-full sm:w-fit">
        <Link to="/">Back to Shipfox</Link>
      </ButtonLink>
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
          <Link to="/">Back to Shipfox</Link>
        </ButtonLink>
      </div>
    </GithubOutcome>
  );
}

function MemberWorkspaceActions({
  workspaces,
}: {
  workspaces: ReturnType<typeof useAuthState>['workspaces'];
}) {
  return (
    <section className="flex flex-col gap-inline" aria-label="Member workspaces">
      <Text size="sm" className="text-foreground-neutral-muted">
        Continue in a workspace where you are already a member.
      </Text>
      <div className="flex flex-col gap-inline">
        {workspaces.map((workspace) => (
          <div
            key={workspace.id}
            className="flex flex-col gap-inline border-b border-border-neutral-base pb-inline last:border-b-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"
          >
            <Text size="sm" bold className="truncate">
              {workspace.name}
            </Text>
            <div className="flex flex-col gap-inline sm:flex-row">
              <ButtonLink asChild className="min-h-44 w-full sm:w-fit">
                <Link
                  to="/w/$workspaceSlug/integrations"
                  params={{workspaceSlug: workspace.slug}}
                  aria-label={`Open workspace – ${workspace.name}`}
                >
                  Open workspace
                </Link>
              </ButtonLink>
              <ButtonLink asChild variant="muted" className="min-h-44 w-full sm:w-fit">
                <Link
                  to="/w/$workspaceSlug/settings/members"
                  params={{workspaceSlug: workspace.slug}}
                  aria-label={`Invite a teammate to ${workspace.name}`}
                >
                  Invite a teammate
                </Link>
              </ButtonLink>
            </div>
          </div>
        ))}
      </div>
    </section>
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
  status: 'error' | 'info' | 'success' | 'warning';
  children: React.ReactNode;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => headingRef.current?.focus(), []);
  return (
    <main className="flex min-h-screen px-frame py-frame">
      <FocusedFrame className="flex flex-col justify-center gap-section">
        <h1 ref={headingRef} tabIndex={-1} className="text-24 font-semibold outline-none">
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
          'This installation link has expired. Start the installation again from a member workspace.',
        status: 'warning',
      };
    case 'invalid':
      return {
        title: 'Invalid GitHub callback',
        message:
          'Shipfox could not verify this installation link. Start again from a member workspace.',
        status: 'error',
      };
    case 'actor-mismatch':
      return {
        title: 'Use the account that started this install',
        message:
          'This callback belongs to another Shipfox account. Return to a member workspace and start a new installation for this account.',
        status: 'warning',
      };
    case 'not-authorized':
      return {
        title: 'GitHub access could not be verified',
        message:
          'This account cannot connect the selected GitHub installation. Return to a member workspace to try another installation.',
        status: 'warning',
      };
    case 'already-linked':
      return {
        title: 'GitHub is already connected elsewhere',
        message:
          'This GitHub installation cannot be moved from another workspace. Choose another installation or return to a member workspace.',
        status: 'warning',
      };
    case 'provider-error':
      return {
        title: 'GitHub is temporarily unavailable',
        message:
          'The connection was not completed. Return to a member workspace and start the installation again.',
        status: 'warning',
      };
    case 'unknown':
      return {
        title: 'Could not connect GitHub',
        message:
          'The connection was not completed. Return to a member workspace and start the installation again.',
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
