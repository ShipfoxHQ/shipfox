import {useActiveWorkspace} from '@shipfox/client-auth';
import {Button} from '@shipfox/react-ui/button';
import {Callout} from '@shipfox/react-ui/callout';
import {FormField, FormFieldInput, fieldError} from '@shipfox/react-ui/form-field';
import {
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  ModalTrigger,
} from '@shipfox/react-ui/modal';
import {Panel, PanelBody, PanelHeader, PanelTitle} from '@shipfox/react-ui/panel';
import {toast} from '@shipfox/react-ui/toast';
import {Text} from '@shipfox/react-ui/typography';
import {useForm} from '@tanstack/react-form';
import {useNavigate} from '@tanstack/react-router';
import {useState} from 'react';
import type {Project} from '#core/project.js';
import {useDeleteProjectMutation} from '#hooks/api/projects.js';
import {deleteProjectErrorToFormError} from './delete-project-form-errors.js';

export function DeleteProjectSection({project}: {project: Project}) {
  const [open, setOpen] = useState(false);
  const deleteProject = useDeleteProjectMutation();

  return (
    <Panel>
      <PanelHeader>
        <PanelTitle>Delete project</PanelTitle>
      </PanelHeader>
      <PanelBody className="items-start gap-group p-panel">
        <Text size="sm" className="text-foreground-neutral-muted">
          Deleting a project stops its active runs and agent turns, then deletes its workflows,
          triggers, secrets, variables, cache, agents, conversations, and run history. This
          can&apos;t be undone.
        </Text>
        <Modal
          open={open}
          onOpenChange={(nextOpen) => {
            if (deleteProject.isPending && !nextOpen) return;
            setOpen(nextOpen);
          }}
        >
          <ModalTrigger asChild>
            <Button type="button" variant="danger">
              Delete project
            </Button>
          </ModalTrigger>
          <ModalContent aria-describedby={undefined} className="max-w-[480px]">
            <ModalTitle className="sr-only">Delete {project.name}?</ModalTitle>
            <ModalHeader title={`Delete ${project.name}?`} showClose={!deleteProject.isPending} />
            <DeleteProjectForm
              project={project}
              isPending={deleteProject.isPending}
              onCancel={() => setOpen(false)}
              onDelete={(name) =>
                deleteProject.mutateAsync({
                  workspaceId: project.workspaceId,
                  projectId: project.id,
                  name,
                })
              }
            />
          </ModalContent>
        </Modal>
      </PanelBody>
    </Panel>
  );
}

function DeleteProjectForm({
  project,
  isPending,
  onCancel,
  onDelete,
}: {
  project: Project;
  isPending: boolean;
  onCancel: () => void;
  onDelete: (name: string) => Promise<void>;
}) {
  const workspace = useActiveWorkspace();
  const navigate = useNavigate();
  const [formError, setFormError] = useState<string>();

  const form = useForm({
    defaultValues: {name: ''},
    onSubmit: async ({value}) => {
      setFormError(undefined);
      try {
        await onDelete(value.name);
      } catch (error) {
        const mapped = deleteProjectErrorToFormError(error);
        if (mapped.kind === 'field') {
          form.setFieldMeta(mapped.field, (previous) => ({
            ...previous,
            errorMap: {...previous.errorMap, onServer: mapped.message},
          }));
        } else {
          setFormError(mapped.message);
        }
        return;
      }
      toast.success(`${project.name} deleted.`);
      await navigate({to: '/w/$workspaceSlug', params: {workspaceSlug: workspace.slug}});
    },
  });

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void form.handleSubmit();
      }}
    >
      <ModalBody className="gap-group">
        <Text size="sm">
          Active runs and agent turns stop now. Slack threads and Linear sessions of its
          conversations get no further reply.
          {project.source.kind === 'linked'
            ? " The linked repository isn't changed, and its .shipfox/ folder stays."
            : null}
        </Text>
        {formError ? (
          <Callout role="alert" type="error">
            {formError}
          </Callout>
        ) : null}
        <form.Field
          name="name"
          validators={{
            onSubmit: ({value}) =>
              value === project.name ? undefined : 'Type the project name to confirm.',
          }}
        >
          {(field) => (
            <FormField
              label={
                <>
                  Type <strong className="font-medium">{project.name}</strong> to confirm
                </>
              }
              id="delete-project-name"
              error={fieldError(field)}
            >
              <FormFieldInput
                name="name"
                type="text"
                autoComplete="off"
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value)}
                onBlur={field.handleBlur}
              />
            </FormField>
          )}
        </form.Field>
      </ModalBody>
      <ModalFooter>
        <Button type="button" variant="secondary" disabled={isPending} onClick={onCancel}>
          Cancel
        </Button>
        <form.Subscribe selector={(state) => state.values.name === project.name}>
          {(nameMatches) => (
            <Button type="submit" variant="danger" isLoading={isPending} disabled={!nameMatches}>
              Delete project
            </Button>
          )}
        </form.Subscribe>
      </ModalFooter>
    </form>
  );
}
