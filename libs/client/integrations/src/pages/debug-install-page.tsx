import {ApiError} from '@shipfox/client-api';
import {useAuthState} from '@shipfox/client-auth';
import {Alert, Button, Card, CardContent, Text, toast} from '@shipfox/react-ui';
import {useQueryClient} from '@tanstack/react-query';
import {Link, useNavigate} from '@tanstack/react-router';
import {useState} from 'react';
import {SetupPageShell} from '#components/setup-page-shell.js';
import {integrationsQueryKeys, useCreateDebugConnectionMutation} from '#hooks/api/integrations.js';

export function DebugInstallPage() {
  const auth = useAuthState();
  const workspace = auth.workspaces[0];
  const createConnection = useCreateDebugConnectionMutation();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [errorMessage, setErrorMessage] = useState<string | undefined>();

  async function onConnect() {
    setErrorMessage(undefined);
    if (!workspace) {
      setErrorMessage('Workspace is still loading. Try again in a moment.');
      return;
    }
    try {
      await createConnection.mutateAsync({workspace_id: workspace.id});
      await queryClient.invalidateQueries({
        queryKey: integrationsQueryKeys.sourceConnections(workspace.id),
      });
      toast.success('Debug source control connected.');
      await navigate({to: '/'});
    } catch (error) {
      setErrorMessage(
        error instanceof ApiError ? error.message : 'Could not connect Debug source control.',
      );
    }
  }

  return (
    <SetupPageShell
      heading="Connect Debug"
      subtitle="Three local fixture repositories for development and tests."
      footer={
        <>
          <Button
            type="button"
            iconRight="chevronRight"
            isLoading={createConnection.isPending}
            onClick={onConnect}
          >
            Connect Debug
          </Button>
          <Button asChild variant="transparent">
            <Link to="/setup/integrations">Back to integrations</Link>
          </Button>
        </>
      }
    >
      <Card className="p-24">
        <CardContent className="flex flex-col gap-12">
          <Text size="sm">
            Debug is a fixture provider. It exposes three predefined repositories without contacting
            any external service. Use it for local development and tests, not for production.
          </Text>
        </CardContent>
      </Card>

      {errorMessage ? (
        <Alert variant="error">
          <Text size="sm">{errorMessage}</Text>
        </Alert>
      ) : null}
    </SetupPageShell>
  );
}
