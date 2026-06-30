import type {SentryConnectResponseDto} from '@shipfox/api-integration-sentry-dto';
import {useAuthState, useRefreshAuth} from '@shipfox/client-auth';
import {
  Alert,
  Button,
  ButtonLink,
  Card,
  FullPageLoader,
  Header,
  Text,
  toast,
} from '@shipfox/react-ui';
import {useQueryClient} from '@tanstack/react-query';
import {Link, useNavigate, useSearch} from '@tanstack/react-router';
import {useEffect, useMemo, useRef, useState} from 'react';
import {connectSentry, integrationsQueryKeys} from '#hooks/api/integrations.js';
import {
  classifySentryConnectError,
  clearSentryInstallWorkspace,
  parseSentryCallbackParams,
  preselectSentryWorkspace,
  readSentryInstallWorkspace,
  type SentryConnectFailure,
} from '#sentry-callback.js';

// De-dupes concurrent attempts for the same installation+workspace+code
// (double click, remount while in flight). Entries are evicted once the
// request settles, so Retry, and any later attempt carrying a fresh grant
// code, always issues a genuinely new request instead of replaying a cached
// outcome.
const connectRequests = new Map<string, Promise<SentryConnectResponseDto>>();

export function SentryCallbackPage() {
  const search = useSearch({strict: false});
  const navigate = useNavigate();
  const refreshAuth = useRefreshAuth();
  const {workspaces, isLoading} = useAuthState();
  const queryClient = useQueryClient();

  const params = useMemo(() => parseSentryCallbackParams(search), [search]);
  const storedWorkspaceId = useMemo(() => readSentryInstallWorkspace(window.sessionStorage), []);
  const preselection = preselectSentryWorkspace(storedWorkspaceId, workspaces);
  const preselectedId = preselection.kind === 'pick' ? preselection.preselectedId : undefined;

  const [connectingId, setConnectingId] = useState<string | undefined>();
  const [failure, setFailure] = useState<
    {workspaceId: string; failure: SentryConnectFailure} | undefined
  >();
  const [retryLocked, setRetryLocked] = useState(false);
  const disposedRef = useRef(false);

  useEffect(() => {
    disposedRef.current = false;
    return () => {
      disposedRef.current = true;
    };
  }, []);

  // Wait for auth before treating an empty workspace list as "no workspace": on
  // a cold return from Sentry, `workspaces` is [] until the session refresh
  // resolves, and bouncing to `/` then would discard the one-shot grant code.
  const noWorkspace = !isLoading && preselection.kind === 'none';
  useEffect(() => {
    if (!noWorkspace) return;
    toast.error('You need a workspace before installing Sentry.');
    navigate({to: '/', replace: true});
  }, [noWorkspace, navigate]);

  const retryAfterSeconds =
    failure?.failure.kind === 'retryable' ? failure.failure.retryAfterSeconds : undefined;
  useEffect(() => {
    // No backoff window (any non-rate-limited failure) re-enables Retry, so a
    // prior rate-limit lock can never strand the button in a disabled state.
    if (!retryAfterSeconds) {
      setRetryLocked(false);
      return;
    }
    setRetryLocked(true);
    const timer = setTimeout(() => setRetryLocked(false), retryAfterSeconds * 1000);
    return () => clearTimeout(timer);
  }, [retryAfterSeconds]);

  if (!params) {
    return (
      <CallbackColumn>
        <Alert variant="error">
          <Text size="sm">
            This Sentry link is missing required parameters. Start the install again from your
            workspace settings.
          </Text>
        </Alert>
        <ButtonLink asChild variant="muted" className="w-fit">
          <Link to="/">Back to Shipfox</Link>
        </ButtonLink>
      </CallbackColumn>
    );
  }

  // Hold the loader until auth resolves; the workspace list and the
  // noWorkspace redirect both depend on a settled `workspaces`.
  if (isLoading) return <FullPageLoader />;

  if (noWorkspace) return null;

  const connect = (workspaceId: string) => {
    setConnectingId(workspaceId);
    setFailure(undefined);
    const key = `${params.installationId}|${workspaceId}|${params.code}`;
    let request = connectRequests.get(key);
    if (!request) {
      request = refreshAuth().then((session) =>
        connectSentry({
          body: {
            workspace_id: workspaceId,
            code: params.code,
            installation_id: params.installationId,
          },
          token: session.token,
        }),
      );
      // Evict on settle (success or failure) so the key never replays a stale
      // outcome. Two-arg `then` keeps this cleanup branch from surfacing the
      // rejection as unhandled — the main chain below owns the user-facing
      // failure handling.
      const evict = () => connectRequests.delete(key);
      request.then(evict, evict);
      connectRequests.set(key, request);
    }

    request
      .then(async () => {
        clearSentryInstallWorkspace(window.sessionStorage);
        await queryClient.invalidateQueries({
          queryKey: integrationsQueryKeys.connectionsByWorkspace(workspaceId),
        });
        if (disposedRef.current) return;
        toast.success('Sentry installed.');
        await navigate({
          to: '/workspaces/$wid/settings/integrations',
          params: {wid: workspaceId},
          replace: true,
        });
      })
      .catch((error: unknown) => {
        if (disposedRef.current) return;
        const classified = classifySentryConnectError(error);
        if (classified.kind === 'terminal') {
          // Only a fresh install (new grant code) can recover; the stored
          // handoff has served its purpose either way.
          clearSentryInstallWorkspace(window.sessionStorage);
        }
        setConnectingId(undefined);
        setFailure({workspaceId, failure: classified});
      });
  };

  const orderedWorkspaces = preselectedId
    ? [
        ...workspaces.filter((workspace) => workspace.id === preselectedId),
        ...workspaces.filter((workspace) => workspace.id !== preselectedId),
      ]
    : workspaces;

  const failureWorkspaceId = failure?.workspaceId ?? preselectedId ?? workspaces[0]?.id;

  return (
    <CallbackColumn>
      <header className="flex flex-col gap-8">
        <Header variant="h2">Install Sentry</Header>
        <Text size="sm" className="text-foreground-neutral-muted">
          {params.orgSlug
            ? `Install the Sentry org "${params.orgSlug}" in a workspace.`
            : 'Install this Sentry integration in a workspace.'}
        </Text>
      </header>

      {failure ? (
        <Alert variant="error">
          <div className="flex flex-col gap-8">
            <Text size="sm">{failure.failure.message}</Text>
            {failure.failure.kind === 'retryable' ? (
              <Button
                size="sm"
                variant="secondary"
                className="w-fit"
                disabled={retryLocked || connectingId !== undefined}
                onClick={() => connect(failure.workspaceId)}
              >
                Retry
              </Button>
            ) : null}
            {failure.failure.kind === 'terminal' && failure.failure.startOver ? (
              <Button asChild size="sm" variant="secondary" className="w-fit">
                <Link to="/workspaces/$wid/integrations/sentry" params={{wid: failure.workspaceId}}>
                  Start over
                </Link>
              </Button>
            ) : null}
          </div>
        </Alert>
      ) : null}

      <section className="flex flex-col gap-8" aria-label="Choose a workspace">
        {orderedWorkspaces.map((workspace) => (
          <Card key={workspace.id} className="p-16">
            <div className="flex items-center justify-between gap-12">
              <Text size="md" bold className="truncate">
                {workspace.name}
              </Text>
              <Button
                variant="secondary"
                disabled={connectingId !== undefined}
                isLoading={connectingId === workspace.id}
                onClick={() => connect(workspace.id)}
              >
                Install
              </Button>
            </div>
          </Card>
        ))}
      </section>

      {failureWorkspaceId ? (
        <ButtonLink asChild variant="muted" className="w-fit">
          <Link to="/workspaces/$wid/settings/integrations" params={{wid: failureWorkspaceId}}>
            Back to settings
          </Link>
        </ButtonLink>
      ) : null}
    </CallbackColumn>
  );
}

function CallbackColumn({children}: {children: React.ReactNode}) {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-[480px] flex-col justify-center gap-20 px-16 py-32">
      {children}
    </div>
  );
}
