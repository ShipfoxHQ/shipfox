import {useActiveWorkspace} from '@shipfox/client-auth';
import {
  Alert,
  Button,
  ButtonLink,
  FormField,
  FormFieldInput,
  fieldError,
  Header,
  Text,
  toast,
} from '@shipfox/react-ui';
import {useForm} from '@tanstack/react-form';
import {useQueryClient} from '@tanstack/react-query';
import {Link, useNavigate} from '@tanstack/react-router';
import {useState} from 'react';
import {integrationsQueryKeys, useCreateGiteaConnectionMutation} from '#hooks/api/integrations.js';
import {giteaConnectErrorToFormError} from './gitea-form-errors.js';

export function GiteaInstallPage() {
  const workspace = useActiveWorkspace();
  const connect = useCreateGiteaConnectionMutation();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [formError, setFormError] = useState<string | undefined>();

  const form = useForm({
    defaultValues: {org: ''},
    onSubmit: async ({value}) => {
      setFormError(undefined);
      const workspaceId = workspace.id;
      try {
        await connect.mutateAsync({workspace_id: workspaceId, org: value.org.trim()});
        await queryClient.invalidateQueries({
          queryKey: integrationsQueryKeys.sourceConnections(workspaceId),
          // The workspace home is the next active observer, not this page, so the
          // default 'active' refetch would no-op and leave the cache stale until
          // after the home redirects back here.
          refetchType: 'all',
        });
        toast.success('Gitea organization installed.');
        await navigate({to: '/workspaces/$wid', params: {wid: workspaceId}});
      } catch (error) {
        const mapped = giteaConnectErrorToFormError(error);
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

  return (
    <div className="mx-auto flex w-full max-w-[480px] flex-col gap-20">
      <header className="flex flex-col gap-8">
        <Header variant="h1">Install Gitea</Header>
        <Text size="md" className="text-foreground-neutral-muted">
          Enter the Gitea organization to install in this workspace.
        </Text>
      </header>

      <form
        className="flex flex-col gap-18"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          event.stopPropagation();
          void form.handleSubmit();
        }}
      >
        {formError ? <Alert variant="error">{formError}</Alert> : null}
        <form.Field
          name="org"
          validators={{
            onBlur: ({value}) =>
              value.trim().length > 0 ? undefined : 'Enter your Gitea organization.',
            onSubmit: ({value}) =>
              value.trim().length > 0 ? undefined : 'Enter your Gitea organization.',
          }}
        >
          {(field) => (
            <FormField label="Organization" id="gitea-org" error={fieldError(field)}>
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
        <div className="flex items-center gap-12">
          <Button type="submit" isLoading={connect.isPending}>
            Install
          </Button>
          <ButtonLink asChild variant="muted">
            <Link to="/workspaces/$wid/integrations" params={{wid: workspace.id}}>
              Cancel
            </Link>
          </ButtonLink>
        </div>
      </form>
    </div>
  );
}
