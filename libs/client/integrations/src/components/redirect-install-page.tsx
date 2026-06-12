import {ApiError} from '@shipfox/client-api';
import {useActiveWorkspace} from '@shipfox/client-auth';
import {Alert, ButtonLink, FullPageLoader, Text} from '@shipfox/react-ui';
import {useMutation} from '@tanstack/react-query';
import {Link} from '@tanstack/react-router';
import {useEffect, useRef, useState} from 'react';

interface RedirectInstallPageProps {
  installRequest: (body: {workspace_id: string}) => Promise<{install_url: string}>;
  errorFallbackMessage: string;
  /**
   * Runs before leaving the app (e.g. to persist the workspace id for a
   * state-less provider callback). Must not throw — a failed side effect
   * should never block the redirect.
   */
  beforeRedirect?: (workspaceId: string) => void;
  /** Injectable for tests: jsdom's window.location cannot be stubbed. */
  assignLocation?: (url: string) => void;
}

export function RedirectInstallPage({
  installRequest,
  errorFallbackMessage,
  beforeRedirect,
  assignLocation = (url) => window.location.assign(url),
}: RedirectInstallPageProps) {
  const workspace = useActiveWorkspace();
  const createInstall = useMutation({mutationFn: installRequest});
  const startedRef = useRef(false);
  const [errorMessage, setErrorMessage] = useState<string | undefined>();

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    // The side effect is best-effort persistence; a throw here must never
    // block the install redirect, so swallow it and continue.
    try {
      beforeRedirect?.(workspace.id);
    } catch {
      // ignore
    }
    createInstall
      .mutateAsync({workspace_id: workspace.id})
      .then((response) => {
        assignLocation(response.install_url);
      })
      .catch((error: unknown) => {
        setErrorMessage(error instanceof ApiError ? error.message : errorFallbackMessage);
      });
  }, [workspace, createInstall, beforeRedirect, errorFallbackMessage, assignLocation]);

  if (errorMessage) {
    return (
      <div className="mx-auto flex w-full max-w-[480px] flex-col gap-16">
        <Alert variant="error">
          <Text size="sm">{errorMessage}</Text>
        </Alert>
        <ButtonLink asChild variant="muted" className="w-fit">
          <Link to="/workspaces/$wid/integrations" params={{wid: workspace.id}}>
            Back to integrations
          </Link>
        </ButtonLink>
      </div>
    );
  }

  return <FullPageLoader />;
}
