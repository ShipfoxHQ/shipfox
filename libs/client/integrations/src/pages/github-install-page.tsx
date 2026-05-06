import {ApiError} from '@shipfox/client-api';
import {useAuthState, useMaybeActiveWorkspace} from '@shipfox/client-auth';
import {Alert, ButtonLink, FullPageLoader, Text} from '@shipfox/react-ui';
import {Link} from '@tanstack/react-router';
import {useEffect, useRef, useState} from 'react';
import {useCreateGithubInstallMutation} from '#hooks/api/integrations.js';

export function GithubInstallPage() {
  const auth = useAuthState();
  const activeWorkspace = useMaybeActiveWorkspace();
  const workspace = activeWorkspace ?? auth.workspaces[0];
  const createInstall = useCreateGithubInstallMutation();
  const startedRef = useRef(false);
  const [errorMessage, setErrorMessage] = useState<string | undefined>();

  useEffect(() => {
    if (!workspace || startedRef.current) return;
    startedRef.current = true;
    createInstall
      .mutateAsync({workspace_id: workspace.id})
      .then((response) => {
        window.location.assign(response.install_url);
      })
      .catch((error: unknown) => {
        setErrorMessage(
          error instanceof ApiError ? error.message : 'Could not start GitHub install.',
        );
      });
  }, [workspace, createInstall]);

  if (errorMessage) {
    return (
      <main className="min-h-screen bg-background-subtle-base px-24 py-32 max-[520px]:px-16">
        <div className="mx-auto flex w-full max-w-[480px] flex-col gap-16">
          <Alert variant="error">
            <Text size="sm">{errorMessage}</Text>
          </Alert>
          <ButtonLink asChild variant="muted" className="w-fit">
            <Link to="/setup/integrations">Back to integrations</Link>
          </ButtonLink>
        </div>
      </main>
    );
  }

  return <FullPageLoader />;
}
