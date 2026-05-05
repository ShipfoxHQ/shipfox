import {ApiError} from '@shipfox/client-api';
import {useAuthState} from '@shipfox/client-auth';
import {Alert, ButtonLink, FullPageLoader, Text, toast} from '@shipfox/react-ui';
import {useQueryClient} from '@tanstack/react-query';
import {Link, useNavigate} from '@tanstack/react-router';
import {useEffect, useRef, useState} from 'react';
import {integrationsQueryKeys, useCreateDebugConnectionMutation} from '#hooks/api/integrations.js';

export function DebugInstallPage() {
  const auth = useAuthState();
  const workspace = auth.workspaces[0];
  const createConnection = useCreateDebugConnectionMutation();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const startedRef = useRef(false);
  const [errorMessage, setErrorMessage] = useState<string | undefined>();

  useEffect(() => {
    if (!workspace || startedRef.current) return;
    startedRef.current = true;
    const workspaceId = workspace.id;
    createConnection
      .mutateAsync({workspace_id: workspaceId})
      .then(async () => {
        await queryClient.invalidateQueries({
          queryKey: integrationsQueryKeys.sourceConnections(workspaceId),
        });
        toast.success('Debug source control connected.');
        await navigate({to: '/'});
      })
      .catch((error: unknown) => {
        setErrorMessage(
          error instanceof ApiError ? error.message : 'Could not connect Debug source control.',
        );
      });
  }, [workspace, createConnection, queryClient, navigate]);

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
