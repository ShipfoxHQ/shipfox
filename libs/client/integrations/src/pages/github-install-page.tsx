import {ApiError} from '@shipfox/client-api';
import {useActiveWorkspace} from '@shipfox/client-auth';
import {Alert, ButtonLink, FullPageLoader, Text} from '@shipfox/react-ui';
import {Link} from '@tanstack/react-router';
import {useEffect, useRef, useState} from 'react';
import {useCreateGithubInstallMutation} from '#hooks/api/integrations.js';

export function GithubInstallPage() {
  const workspace = useActiveWorkspace();
  const createInstall = useCreateGithubInstallMutation();
  const startedRef = useRef(false);
  const [errorMessage, setErrorMessage] = useState<string | undefined>();

  useEffect(() => {
    if (startedRef.current) return;
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
