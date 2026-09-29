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
import {Panel} from '@shipfox/react-ui/panel';
import {toast} from '@shipfox/react-ui/toast';
import {Text} from '@shipfox/react-ui/typography';
import {useQueryClient} from '@tanstack/react-query';
import {Link, useNavigate} from '@tanstack/react-router';
import {useEffect, useMemo, useRef, useState} from 'react';
import {
  useCompleteIntegrationCallback,
  useCompleteIntegrationCallbackResult,
  useResolveIntegrationWorkspaceSlug,
} from '#application/complete-integration-callback.js';
import {useGithubRecovery} from '#application/use-github-recovery.js';
import type {
  GithubLinkCandidate,
  GithubLinkSelection,
  IntegrationConnection,
} from '#core/models.js';
import {
  classifyGithubCallback,
  classifyGithubCallbackError,
  clearGithubInstallWorkspace,
  type GithubCallbackFailure,
  GithubCallbackIncompleteError,
  type GithubCallbackIntent,
  type GithubCallbackSearch,
  getGithubCallbackTelemetry,
  readGithubInstallWorkspace,
  serializeGithubCallback,
  serializeGithubLinkCallback,
} from '#github-callback.js';
import {
  completeGithubCallback,
  completeGithubLink,
  selectGithubLinkInstallation,
} from '#hooks/api/integrations.js';
import {rememberCallbackKey} from '#workspace-navigation.js';

const callbackRequests = createSingleFlight<string, IntegrationConnection | GithubLinkSelection>({
  maxTerminalResults: 32,
});
const selectionRequests = createSingleFlight<string, IntegrationConnection>();
const capturedCompletions = new Set<string>();
const capturedCallbackOutcomes = new Set<string>();
const reportedFailures = new Set<string>();
const capturedLinkFailures = new Set<string>();
const reportedIncompleteCallbacks = new Set<string>();
const toastedCallbacks = new Set<string>();
type GithubOutcomeStatus = 'error' | 'info' | 'success' | 'warning';

export function GithubCallbackPage({
  search,
  assignLocation,
}: {
  search: GithubCallbackSearch;
  assignLocation?: (url: string) => void;
}) {
  const auth = useAuthState();
  const analytics = useClientAnalytics();
  const completeIntegrationCallback = useCompleteIntegrationCallback();
  const completeIntegrationCallbackResult = useCompleteIntegrationCallbackResult();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const refreshAuth = useRefreshAuth();
  const resolveIntegrationWorkspaceSlug = useResolveIntegrationWorkspaceSlug();
  const intent = useMemo(() => classifyGithubCallback(search), [search]);
  const landingKey = useMemo(() => serializeGithubCallbackLanding(search), [search]);
  const storedWorkspaceId = useMemo(
    () => readGithubInstallWorkspace(sessionStorageOrUndefined()),
    [],
  );
  const storedWorkspace = auth.workspaces.find(({id}) => id === storedWorkspaceId);
  const [failure, setFailure] = useState<GithubCallbackFailure>();
  const [selection, setSelection] = useState<GithubLinkSelection>();
  const [completedWorkspaceId, setCompletedWorkspaceId] = useState<string>();
  const capturedViews = useRef(new Set<string>());
  const membershipHydrationFailed =
    auth.isAuthenticated &&
    !auth.hasWorkspace &&
    queryClient.getQueryState(userWorkspacesQueryKey)?.status === 'error';

  useEffect(() => {
    if (
      intent.kind !== 'invalid' ||
      reportedIncompleteCallbacks.has(landingKey) ||
      typeof globalThis.reportError !== 'function'
    ) {
      return;
    }
    rememberCallbackKey(reportedIncompleteCallbacks, landingKey);
    globalThis.reportError(new GithubCallbackIncompleteError(intent.missing));
  }, [intent, landingKey]);

  useEffect(() => {
    if (auth.isLoading || capturedCallbackOutcomes.has(landingKey)) return;
    rememberCallbackKey(capturedCallbackOutcomes, landingKey);
    analytics.capture(
      'github_callback_outcome',
      getGithubCallbackTelemetry(search, intent, auth.isAuthenticated),
    );
  }, [analytics, auth.isAuthenticated, auth.isLoading, intent, landingKey, search]);

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

  const isRecovering = useGithubRecovery({
    intent,
    landingKey,
    storedWorkspaceId: storedWorkspace?.id,
    ...(assignLocation ? {assignLocation} : {}),
  });

  const isTerminalWithoutApi =
    !membershipHydrationFailed &&
    ((intent.kind !== 'complete' && intent.kind !== 'link') ||
      (!auth.isLoading && (!auth.isAuthenticated || !auth.hasWorkspace)));
  useEffect(() => {
    if (!isTerminalWithoutApi) return;
    clearGithubInstallWorkspace(sessionStorageOrUndefined());
  }, [isTerminalWithoutApi]);

  useEffect(() => {
    if (
      (intent.kind !== 'complete' && intent.kind !== 'link') ||
      auth.isLoading ||
      !auth.isAuthenticated ||
      !auth.hasWorkspace ||
      completedWorkspaceId
    ) {
      return;
    }

    let active = true;
    const callbackKey =
      intent.kind === 'complete'
        ? serializeGithubCallback(intent.params)
        : `link:${serializeGithubLinkCallback(intent.params)}`;
    clearGithubInstallWorkspace(sessionStorageOrUndefined());
    const request = callbackRequests.run(callbackKey, async () =>
      intent.kind === 'complete'
        ? await completeIntegrationCallback({
            input: intent.params,
            refreshAuth,
            complete: async (input, token) => await completeGithubCallback({...input, token}),
          })
        : await completeIntegrationCallbackResult({
            input: intent.params,
            refreshAuth,
            complete: completeGithubLink,
            getConnection: linkedConnection,
          }),
    );

    request.then(
      async (result) =>
        await handleGithubCallbackResult({
          result,
          setSelection,
          callbackKey,
          linked: intent.kind === 'link',
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
        if (intent.kind === 'link') captureLinkFailure(analytics, callbackKey, classified);
        reportUnexpectedFailure(error, callbackKey);
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
    completeIntegrationCallbackResult,
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

  if (isRecovering) return <FullPageLoader aria-label="Connecting GitHub" />;

  const terminal = terminalIntentOutcome(intent);
  if (terminal) return terminal;

  return (
    <GithubCallbackResult
      completedWorkspaceId={completedWorkspaceId}
      selection={selection}
      failure={failure}
    />
  );
}

function GithubCallbackResult({
  completedWorkspaceId,
  selection,
  failure,
}: {
  completedWorkspaceId: string | undefined;
  selection: GithubLinkSelection | undefined;
  failure: GithubCallbackFailure | undefined;
}) {
  if (completedWorkspaceId) return <GithubInstalledOutcome />;
  if (selection) return <GithubInstallationPicker selection={selection} />;
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

function linkedConnection(
  result: IntegrationConnection | GithubLinkSelection,
): IntegrationConnection | undefined {
  return 'selectionToken' in result ? undefined : result;
}

async function handleGithubCallbackResult({
  result,
  setSelection,
  linked,
  ...params
}: Omit<Parameters<typeof handleGithubCallbackSuccess>[0], 'connection' | 'linkCandidates'> & {
  result: IntegrationConnection | GithubLinkSelection;
  setSelection: (selection: GithubLinkSelection) => void;
  linked: boolean;
}) {
  if (!('selectionToken' in result)) {
    await handleGithubCallbackSuccess({
      ...params,
      connection: result,
      linkCandidates: linked ? '1' : undefined,
    });
    return;
  }
  if (params.isActive()) setSelection(result);
}

async function handleGithubCallbackSuccess({
  connection,
  callbackKey,
  linkCandidates,
  analytics,
  workspaces,
  resolveIntegrationWorkspaceSlug,
  navigate,
  isActive,
  setCompletedWorkspaceId,
}: {
  connection: IntegrationConnection;
  callbackKey: string;
  linkCandidates: '1' | 'many' | undefined;
  analytics: ReturnType<typeof useClientAnalytics>;
  workspaces: ReturnType<typeof useAuthState>['workspaces'];
  resolveIntegrationWorkspaceSlug: ReturnType<typeof useResolveIntegrationWorkspaceSlug>;
  navigate: ReturnType<typeof useNavigate>;
  isActive: () => boolean;
  setCompletedWorkspaceId: (workspaceId: string) => void;
}) {
  if (!capturedCompletions.has(callbackKey)) {
    rememberCallbackKey(capturedCompletions, callbackKey);
    analytics.capture('github_connection_completed', {workspace_id: connection.workspaceId});
    if (linkCandidates) analytics.capture('github_link_completed', {candidates: linkCandidates});
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

function reportUnexpectedFailure(error: unknown, key: string) {
  const shouldReport = !(error instanceof ApiError) || error.code === 'network-error';
  if (!shouldReport || reportedFailures.has(key)) return;
  rememberCallbackKey(reportedFailures, key);
  globalThis.reportError?.(new Error('Failed to complete the GitHub callback.'));
}

function captureLinkFailure(
  analytics: ReturnType<typeof useClientAnalytics>,
  key: string,
  failure: GithubCallbackFailure,
) {
  if (capturedLinkFailures.has(key)) return;
  rememberCallbackKey(capturedLinkFailures, key);
  analytics.capture('github_link_failed', {reason: failure.kind});
}

/** Holds the selection token in component memory only: never in the URL or storage. */
function GithubInstallationPicker({selection}: {selection: GithubLinkSelection}) {
  const auth = useAuthState();
  const analytics = useClientAnalytics();
  const completeIntegrationCallback = useCompleteIntegrationCallback();
  const navigate = useNavigate();
  const refreshAuth = useRefreshAuth();
  const resolveIntegrationWorkspaceSlug = useResolveIntegrationWorkspaceSlug();
  const [selectedInstallationId, setSelectedInstallationId] = useState<number>();
  const [failure, setFailure] = useState<GithubCallbackFailure>();
  const [completedWorkspaceId, setCompletedWorkspaceId] = useState<string>();
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => headingRef.current?.focus(), []);

  function select(candidate: GithubLinkCandidate) {
    if (selectedInstallationId !== undefined) return;
    setSelectedInstallationId(candidate.installationId);
    setFailure(undefined);
    const selectionKey = `${selection.selectionToken}:${candidate.installationId}`;
    selectionRequests
      .run(selectionKey, async () =>
        completeIntegrationCallback({
          input: {
            selection_token: selection.selectionToken,
            installation_id: candidate.installationId,
          },
          refreshAuth,
          complete: selectGithubLinkInstallation,
        }),
      )
      .then(
        async (connection) =>
          await handleGithubCallbackSuccess({
            connection,
            callbackKey: selectionKey,
            linkCandidates: 'many',
            analytics,
            workspaces: auth.workspaces,
            resolveIntegrationWorkspaceSlug,
            navigate,
            isActive: () => true,
            setCompletedWorkspaceId,
          }),
        (error: unknown) => {
          const classified = classifyGithubCallbackError(error);
          captureLinkFailure(analytics, selectionKey, classified);
          reportUnexpectedFailure(error, selectionKey);
          setSelectedInstallationId(undefined);
          setFailure(classified);
        },
      );
  }

  if (completedWorkspaceId) return <GithubInstalledOutcome />;

  return (
    <main className="flex min-h-screen px-frame py-frame">
      <FocusedFrame className="flex flex-col justify-center gap-section">
        <header className="flex flex-col gap-inline">
          <h1 ref={headingRef} tabIndex={-1} className="text-2xl font-semibold outline-none">
            Choose a GitHub account
          </h1>
          <Text size="sm" className="text-foreground-neutral-muted">
            Shipfox is installed on several GitHub accounts you can access. Choose the one to
            connect to this workspace.
          </Text>
        </header>

        {failure ? (
          <Callout role="alert" type="error">
            <Text size="sm">{failureCopy(failure).message}</Text>
          </Callout>
        ) : null}

        <section className="flex flex-col gap-inline" aria-label="GitHub accounts">
          {selection.candidates.map((candidate) => (
            <Panel key={candidate.installationId} className="p-panel-compact">
              <div className="flex items-center justify-between gap-cluster">
                <div className="min-w-0">
                  <Text size="md" bold className="truncate">
                    {candidate.accountLogin}
                  </Text>
                  <Text size="sm" className="text-foreground-neutral-muted">
                    {githubAccountTypeLabel(candidate.accountType)}
                  </Text>
                </div>
                <Button
                  variant="secondary"
                  aria-label={`Connect ${candidate.accountLogin}`}
                  disabled={selectedInstallationId !== undefined}
                  isLoading={selectedInstallationId === candidate.installationId}
                  onClick={() => select(candidate)}
                >
                  Connect
                </Button>
              </div>
            </Panel>
          ))}
        </section>

        <ShipfoxHomeAction />
      </FocusedFrame>
    </main>
  );
}

function githubAccountTypeLabel(accountType: string): string {
  if (accountType === 'Organization') return 'Organization';
  if (accountType === 'User') return 'Personal account';
  return accountType;
}

function terminalIntentOutcome(intent: GithubCallbackIntent) {
  if (intent.kind === 'request') return <RequestOutcome />;
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
  return undefined;
}

function GithubInstalledOutcome() {
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
    case 'no-linkable':
      return {
        title: 'No GitHub installation to connect',
        message: `${
          failure.linkedElsewhere > 0
            ? 'The Shipfox GitHub App on your account is already connected to another workspace.'
            : 'Shipfox is not installed on any GitHub account you can access.'
        } If your organization uses SAML single sign-on, authorize your GitHub session for it and try again. Go to Shipfox to install GitHub.`,
        status: 'warning',
      };
    case 'too-many-linkable':
      return {
        title: 'Too many GitHub installations found',
        message:
          'Shipfox is installed on more GitHub accounts than it can list here. Contact support and we will connect the right one.',
        status: 'warning',
      };
    case 'suspended':
      return {
        title: 'This GitHub installation is suspended',
        message:
          'An owner of the GitHub account must unsuspend the Shipfox app before it can be connected.',
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

function serializeGithubCallbackLanding(search: GithubCallbackSearch): string {
  return JSON.stringify([
    search.code ?? null,
    search.error ?? null,
    search.errorDescription ?? null,
    search.installationId ?? null,
    search.state ?? null,
    search.setupAction ?? null,
  ]);
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
