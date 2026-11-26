import {useActiveWorkspace} from '@shipfox/client-auth';
import {Button, ButtonLink} from '@shipfox/react-ui/button';
import {Callout} from '@shipfox/react-ui/callout';
import {FormField, FormFieldInput, fieldError} from '@shipfox/react-ui/form-field';
import {toast} from '@shipfox/react-ui/toast';
import {Header, Text} from '@shipfox/react-ui/typography';
import {useForm} from '@tanstack/react-form';
import {Link, useNavigate} from '@tanstack/react-router';
import {useState} from 'react';
import {CopyableValue} from '#components/webhook/copyable-value.js';
import type {AzureDevOpsServiceHookSetup} from '#core/models.js';
import {useCreateAzureDevOpsConnectionMutation} from '#hooks/api/integrations.js';
import {azureDevOpsConnectErrorToFormError} from './azure-devops-form-errors.js';

const SERVICE_HOOK_EVENTS =
  'Code pushed, Pull request created, Pull request updated, Pull request commented on, Build completed';

export function AzureDevOpsInstallPage() {
  const workspace = useActiveWorkspace();
  const connect = useCreateAzureDevOpsConnectionMutation();
  const navigate = useNavigate();
  const [formError, setFormError] = useState<string | undefined>();
  const [serviceHook, setServiceHook] = useState<AzureDevOpsServiceHookSetup | undefined>();

  const form = useForm({
    defaultValues: {organization: '', token: ''},
    onSubmit: async ({value}) => {
      setFormError(undefined);
      try {
        const result = await connect.mutateAsync({
          workspace_id: workspace.id,
          organization: value.organization.trim(),
          token: value.token.trim(),
        });
        toast.success('Azure DevOps organization installed.');
        setServiceHook(result.serviceHook);
        // The hook password is shown once; clear the token from the form state right away.
        form.setFieldValue('token', '');
      } catch (error) {
        const mapped = azureDevOpsConnectErrorToFormError(error);
        if (mapped.kind === 'field') {
          form.setFieldMeta(mapped.field, (prev) => ({
            ...prev,
            errorMap: {...prev.errorMap, onServer: mapped.message},
          }));
        } else {
          setFormError(mapped.message);
        }
      }
    },
  });

  if (serviceHook) {
    return (
      <div className="flex w-full flex-col gap-section">
        <header className="flex flex-col gap-inline">
          <Header variant="h1">Set up Service Hooks</Header>
          <Text size="md" className="text-foreground-neutral-muted">
            Shipfox can now read your repositories. To start workflows from pushes and pull
            requests, add a Web Hooks subscription in Azure DevOps (Project settings → Service
            hooks) for each of these events: {SERVICE_HOOK_EVENTS}.
          </Text>
        </header>
        <Callout type="warning">
          Copy the password now. Shipfox shows it only once. Connecting again issues a new one and
          the hooks you configured stop working until you update them.
        </Callout>
        <div className="flex flex-col gap-group">
          <CopyableValue label="URL" value={serviceHook.url} />
          <CopyableValue label="Basic authentication user name" value={serviceHook.username} />
          <CopyableValue label="Basic authentication password" value={serviceHook.password} />
        </div>
        <div className="flex items-center gap-cluster">
          <Button
            onClick={() =>
              void navigate({to: '/w/$workspaceSlug', params: {workspaceSlug: workspace.slug}})
            }
          >
            Done
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col gap-section">
      <header className="flex flex-col gap-inline">
        <Header variant="h1">Install Azure DevOps</Header>
        <Text size="md" className="text-foreground-neutral-muted">
          Enter the Azure DevOps organization and a personal access token with Code (read &amp;
          write) and Pull Request Threads access. Shipfox stores the token in this workspace&apos;s
          secrets.
        </Text>
      </header>

      <form
        className="flex flex-col gap-group"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          event.stopPropagation();
          void form.handleSubmit();
        }}
      >
        {formError ? (
          <Callout role="alert" type="error">
            {formError}
          </Callout>
        ) : null}
        <form.Field
          name="organization"
          validators={{
            onBlur: ({value}) =>
              value.trim().length > 0 ? undefined : 'Enter your Azure DevOps organization.',
            onSubmit: ({value}) =>
              value.trim().length > 0 ? undefined : 'Enter your Azure DevOps organization.',
          }}
        >
          {(field) => (
            <FormField
              label="Organization"
              id="azure-devops-organization"
              error={fieldError(field)}
            >
              <FormFieldInput
                placeholder="my-org"
                autoComplete="off"
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value)}
                onBlur={field.handleBlur}
              />
            </FormField>
          )}
        </form.Field>
        <form.Field
          name="token"
          validators={{
            onSubmit: ({value}) =>
              value.trim().length > 0 ? undefined : 'Enter a personal access token.',
          }}
        >
          {(field) => (
            <FormField
              label="Personal access token"
              id="azure-devops-token"
              error={fieldError(field)}
            >
              <FormFieldInput
                type="password"
                autoComplete="off"
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value)}
                onBlur={field.handleBlur}
              />
            </FormField>
          )}
        </form.Field>
        <div className="flex items-center gap-cluster">
          <Button type="submit" isLoading={connect.isPending}>
            Install
          </Button>
          <ButtonLink asChild variant="muted">
            <Link to="/w/$workspaceSlug/integrations" params={{workspaceSlug: workspace.slug}}>
              Cancel
            </Link>
          </ButtonLink>
        </div>
      </form>
    </div>
  );
}
