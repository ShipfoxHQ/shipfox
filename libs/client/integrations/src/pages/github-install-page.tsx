import {ApiError} from '@shipfox/client-api';
import {useAuthState} from '@shipfox/client-auth';
import {Alert, Button, Card, CardContent, Text} from '@shipfox/react-ui';
import {Link} from '@tanstack/react-router';
import {useState} from 'react';
import {SetupPageShell} from '#components/setup-page-shell.js';
import {useCreateGithubInstallMutation} from '#hooks/api/integrations.js';

export function GithubInstallPage() {
  const auth = useAuthState();
  const workspace = auth.workspaces[0];
  const createInstall = useCreateGithubInstallMutation();
  const [errorMessage, setErrorMessage] = useState<string | undefined>();
  const [redirecting, setRedirecting] = useState(false);

  async function onInstall() {
    setErrorMessage(undefined);
    if (!workspace) {
      setErrorMessage('Workspace is still loading. Try again in a moment.');
      return;
    }
    try {
      const response = await createInstall.mutateAsync({workspace_id: workspace.id});
      setRedirecting(true);
      window.location.assign(response.install_url);
    } catch (error) {
      setErrorMessage(
        error instanceof ApiError ? error.message : 'Could not start GitHub install.',
      );
    }
  }

  const isPending = createInstall.isPending || redirecting;

  return (
    <SetupPageShell
      heading="Connect GitHub"
      subtitle="Install the Shipfox GitHub App on the repositories you want to import."
      footer={
        <>
          <Button type="button" iconRight="chevronRight" isLoading={isPending} onClick={onInstall}>
            Install GitHub App
          </Button>
          {redirecting ? (
            <Text size="sm" className="text-foreground-neutral-muted">
              Redirecting to GitHub…
            </Text>
          ) : null}
          <Button asChild variant="transparent">
            <Link to="/setup/integrations">Back to integrations</Link>
          </Button>
        </>
      }
    >
      <Card className="p-24">
        <CardContent className="flex flex-col gap-12">
          <Text size="sm">
            Shipfox uses a GitHub App to read repository metadata, list branches, and fetch the
            <code> .shipfox</code> config from your repositories.
          </Text>
          <Text size="sm" className="text-foreground-neutral-muted">
            You will be redirected to GitHub to install the app, then brought back here
            automatically.
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
