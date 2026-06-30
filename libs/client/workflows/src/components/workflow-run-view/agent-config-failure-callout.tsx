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
        <AlertTitle>We couldn't load the agent configuration for this step</AlertTitle>
        <AlertDescription>
          Make sure the step prompt, provider, model, and thinking values are set. Then configure
          Agent Providers to add workspace credentials.
        </AlertDescription>
        <AlertActions>
          <Button asChild size="2xs" variant="secondary" iconRight="chevronRight">
            <Link to="/workspaces/$wid/settings/agent-providers" params={{wid: workspaceId}}>
              Configure Agent Providers
            </Link>
          </Button>
        </AlertActions>
      </AlertContent>
    </Alert>
  );
}
