import type {RequiredAction} from '@shipfox/policy-notice';
import {
  Alert,
  AlertActions,
  AlertContent,
  AlertDescription,
  AlertTitle,
} from '@shipfox/react-ui/alert';
import {Button} from '@shipfox/react-ui/button';
import {Link} from '@tanstack/react-router';
import type {AgentStepConfig, StepError} from '#core/workflow-run.js';

const MANAGED_ONLY_PROVIDER_CODE = 'workspace-providers-disabled';

export function AgentConfigFailureCallout({
  workspaceSlug,
  config,
  error,
}: {
  workspaceSlug?: string | undefined;
  config: AgentStepConfig | null;
  error: StepError | null;
}) {
  const copy = agentConfigFailureCopy(config, error);

  return (
    <Alert
      variant="warning"
      animated={false}
      className="rounded-none border-x-0 border-t-0 border-b border-tag-warning-border bg-transparent px-0 py-row"
    >
      <AlertContent>
        <AlertTitle>{copy.title}</AlertTitle>
        <AlertDescription>{copy.description}</AlertDescription>
        {copy.showProviderCta && workspaceSlug ? (
          <AlertActions>
            <Button asChild size="2xs" variant="secondary" iconRight="chevronRight">
              <Link to="/w/$workspaceSlug/settings/agents" params={{workspaceSlug}}>
                Configure Agents
              </Link>
            </Button>
          </AlertActions>
        ) : null}
        {copy.requiredAction ? (
          <AlertActions>
            <Button asChild size="2xs" variant="secondary" iconRight="chevronRight">
              <a href={copy.requiredAction.url}>{copy.requiredAction.message}</a>
            </Button>
          </AlertActions>
        ) : null}
      </AlertContent>
    </Alert>
  );
}

function agentConfigFailureCopy(
  config: AgentStepConfig | null,
  error: StepError | null,
): {
  title: string;
  description: string;
  showProviderCta: boolean;
  requiredAction?: RequiredAction | undefined;
} {
  const managedOnlyProvider = managedOnlyProviderFromError(error);
  if (managedOnlyProvider) {
    return {
      title: `Use ${managedOnlyProvider} models`,
      description: `This Shipfox server only runs ${managedOnlyProvider} models. Set the provider of this step to ${managedOnlyProvider}, or remove the provider. Then start a new run.`,
      showProviderCta: false,
    };
  }

  const provider = configValue(config?.provider, 'the selected provider');
  const model = configValue(config?.model, 'the selected model');

  switch (error?.agentConfigIssue) {
    case 'provider_not_configured':
      return {
        title: `Connect ${provider}`,
        description: `This step uses ${provider}. Your workspace has no credentials for ${provider}. Add them in Agents settings, then rerun the job.`,
        showProviderCta: true,
      };
    case 'credentials_invalid':
      return {
        title: `Update credentials for ${provider}`,
        description: `${provider} rejected the saved credentials. Update them in Agents settings, then rerun the job.`,
        showProviderCta: true,
      };
    case 'provider_unsupported':
      return {
        title: 'Choose another model provider',
        description: `The harness of this step cannot use ${provider}. Change the provider or the harness, then start a new run.`,
        showProviderCta: false,
      };
    case 'model_unavailable':
      if (error.notice !== undefined) {
        return {
          title: `${model} is not available in this workspace`,
          description: `${error.notice.message} To continue without it, choose another model and start a new run.`,
          showProviderCta: false,
          requiredAction: error.notice.requiredAction,
        };
      }
      return {
        title: 'Choose another model',
        description: `${provider} does not offer ${model}. Change the model in this step, then start a new run.`,
        showProviderCta: false,
      };
    case 'step_config_invalid':
      return {
        title: 'Complete the agent step',
        description:
          'An agent step needs a prompt, a provider, a model, and a thinking level. Add the missing values, then start a new run.',
        showProviderCta: false,
      };
    case undefined:
      return {
        title: 'Check the agent step',
        description:
          'Shipfox cannot read the settings of this agent step. Check the step in the workflow file, then start a new run.',
        showProviderCta: true,
      };
  }
}

function managedOnlyProviderFromError(error: StepError | null): string | undefined {
  if (error?.code !== MANAGED_ONLY_PROVIDER_CODE && error?.managedProviderId === undefined) {
    return undefined;
  }
  return error.managedProviderId ?? 'the managed provider';
}

function configValue(value: string | null | undefined, fallback: string): string {
  return value ?? fallback;
}
