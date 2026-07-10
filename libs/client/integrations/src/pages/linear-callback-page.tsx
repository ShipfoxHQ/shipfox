import type {LinearCallbackResponseDto} from '@shipfox/api-integration-linear-dto';
import {useRefreshAuth} from '@shipfox/client-auth';
import {ButtonLink} from '@shipfox/react-ui/button';
import {Callout} from '@shipfox/react-ui/callout';
import {FullPageLoader} from '@shipfox/react-ui/loader';
import {toast} from '@shipfox/react-ui/toast';
import {Text} from '@shipfox/react-ui/typography';
import {useQueryClient} from '@tanstack/react-query';
import {Link, useNavigate, useSearch} from '@tanstack/react-router';
import {useEffect, useMemo, useRef, useState} from 'react';
import {integrationsQueryKeys, useCompleteLinearCallbackMutation} from '#hooks/api/integrations.js';
import {
  classifyLinearCallbackError,
  clearLinearInstallWorkspace,
  type LinearCallbackFailure,
  parseLinearCallbackQuery,
  readLinearInstallWorkspace,
  serializeLinearCallbackQuery,
} from '#linear-callback.js';

// Keyed by the callback's code+state. This page has no in-place Retry (failures
// route to "Start over", which begins a fresh install with a new state+code), so
// entries are intentionally never evicted: retaining them dedupes StrictMode and
// remount re-runs so the single-use grant code is exchanged at most once. The
// sibling Sentry page evicts on settle only because its Retry replays the code.
const callbackRequests = new Map<string, Promise<LinearCallbackResponseDto>>();
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
    let request = callbackRequests.get(key);
    if (!request) {
      request = refreshAuth().then(
        async (session) => await completeLinearCallback({query: params, token: session.token}),
      );
      callbackRequests.set(key, request);
    }

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
            queryKey: integrationsQueryKeys.connectionsByWorkspace(connection.workspace_id),
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
            params: {wid: connection.workspace_id},
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
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const recoveryVariant = failure.startOver || failure.signIn ? 'muted' : 'base';
  const settingsLink = workspaceId ? (
    <ButtonLink asChild variant={recoveryVariant} className="min-h-44 w-full sm:w-fit">
      <Link to="/workspaces/$wid/settings/integrations" params={{wid: workspaceId}}>
        Back to integrations
      </Link>
    </ButtonLink>
  ) : (
    <ButtonLink asChild variant={recoveryVariant} className="min-h-44 w-full sm:w-fit">
      <Link to="/">Back to Shipfox</Link>
    </ButtonLink>
  );

  return (
    <main className="flex min-h-screen bg-background-subtle-base px-16 py-32">
      <div className="mx-auto flex w-full max-w-[480px] flex-col justify-center gap-20">
        <h2 ref={headingRef} tabIndex={-1} className="text-24 font-semibold outline-none">
          {failure.title ?? 'Linear install could not be completed'}
        </h2>
        <Callout role="alert" type="error">
          <Text size="sm">{failure.message}</Text>
        </Callout>
        <div className="flex flex-col gap-8 sm:flex-row sm:items-center">
          {failure.signIn ? (
            <ButtonLink asChild className="min-h-44 w-full sm:w-fit">
              <Link to="/auth/logout">Switch account</Link>
            </ButtonLink>
          ) : null}
          {failure.startOver && workspaceId ? (
            <ButtonLink asChild className="min-h-44 w-full sm:w-fit">
              <Link to="/workspaces/$wid/integrations/linear" params={{wid: workspaceId}}>
                Start over
              </Link>
            </ButtonLink>
          ) : null}
          {settingsLink}
        </div>
      </div>
    </main>
  );
}
