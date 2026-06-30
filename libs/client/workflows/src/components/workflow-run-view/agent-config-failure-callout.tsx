import {
  Alert,
  AlertActions,
  AlertContent,
  AlertDescription,
  AlertTitle,
  Button,
} from '@shipfox/react-ui';
import {Link} from '@tanstack/react-router';

export function AgentConfigFailureCallout({workspaceId}: {workspaceId: string}) {
  return (
    <Alert variant="warning" animated={false} className="px-10 py-8">
      <AlertContent>
        <AlertTitle>Agent configuration blocked this step</AlertTitle>
        <AlertDescription>
          Review the workflow definition values for provider, model, thinking, and prompt. Configure
          workspace provider credentials, or ask the instance operator to set default provider
          credentials.
        </AlertDescription>
        <AlertActions>
          <Button asChild size="2xs" variant="secondary" iconRight="chevronRight">
            <Link to="/workspaces/$wid/settings/agent-providers" params={{wid: workspaceId}}>
              Agent Providers
            </Link>
          </Button>
        </AlertActions>
      </AlertContent>
    </Alert>
  );
}
