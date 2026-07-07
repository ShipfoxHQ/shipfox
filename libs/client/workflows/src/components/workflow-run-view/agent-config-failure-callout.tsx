import {
  Alert,
  AlertActions,
  AlertContent,
  AlertDescription,
  AlertTitle,
} from '@shipfox/react-ui/alert';
import {Button} from '@shipfox/react-ui/button';
import {Link} from '@tanstack/react-router';
import type {StepError} from '#core/workflow-run.js';

export function AgentConfigFailureCallout({
  workspaceId,
  error,
}: {
  workspaceId: string;
  error: StepError | null;
}) {
  const copy = agentConfigFailureCopy(error);

  return (
    <Alert variant="warning" animated={false} className="px-10 py-8">
      <AlertContent>
        <AlertTitle>{copy.title}</AlertTitle>
        <AlertDescription>{copy.description}</AlertDescription>
        {copy.showProviderCta ? (
          <AlertActions>
            <Button asChild size="2xs" variant="secondary" iconRight="chevronRight">
              <Link to="/workspaces/$wid/settings/agents" params={{wid: workspaceId}}>
                Configure Agents
              </Link>
            </Button>
          </AlertActions>
        ) : null}
      </AlertContent>
    </Alert>
  );
}

function agentConfigFailureCopy(error: StepError | null): {
  title: string;
  description: string;
  showProviderCta: boolean;
} {
  const provider = 'the selected provider';
  const model = 'the selected model';

  switch (error?.agentConfigIssue) {
    case 'provider_not_configured':
      return {
        title: `Configure credentials for ${provider}`,
        description: `This step uses ${provider}, but no workspace credentials are configured for that model provider. Configure ${provider} in Agents, then re-run the workflow.`,
        showProviderCta: true,
      };
    case 'credentials_invalid':
      return {
        title: `Update credentials for ${provider}`,
        description: `This step uses ${provider}, but the saved credentials could not be used. Reconfigure ${provider} in Agents, then re-run the workflow.`,
        showProviderCta: true,
      };
    case 'provider_unsupported':
      return {
        title: `Choose a supported model provider`,
        description: `This step references ${provider}, which is not available to the agent runner. Update the workflow to use a supported provider, then re-run it.`,
        showProviderCta: false,
      };
    case 'model_unavailable':
      return {
        title: `Choose an available model`,
        description: `This step uses ${model} with ${provider}, but that model is not available for the provider. Update the model or provider in the workflow, then re-run it.`,
        showProviderCta: false,
      };
    case 'step_config_invalid':
      return {
        title: "Fix this step's agent settings",
        description:
          'Make sure the step has a prompt, provider, model, and thinking value, then re-run the workflow.',
        showProviderCta: false,
      };
    case undefined:
      return {
        title: "We couldn't load the agent configuration for this step",
        description:
          'Make sure the step has a prompt, provider, model, and thinking value. Then configure credentials for the model provider in Agents and re-run the workflow.',
        showProviderCta: true,
      };
  }
}
