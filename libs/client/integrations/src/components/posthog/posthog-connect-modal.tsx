import {type PosthogRegion, posthogConnectBodySchema} from '@shipfox/api-integration-posthog-dto';
import {Button} from '@shipfox/react-ui/button';
import {Callout, CalloutContent, CalloutDescription, CalloutTitle} from '@shipfox/react-ui/callout';
import {FormField, FormFieldInput, fieldError, useFormField} from '@shipfox/react-ui/form-field';
import {
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from '@shipfox/react-ui/modal';
import {RadioGroup, RadioGroupItem} from '@shipfox/react-ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@shipfox/react-ui/select';
import {toast} from '@shipfox/react-ui/toast';
import {Text} from '@shipfox/react-ui/typography';
import {useForm} from '@tanstack/react-form';
import {useEffect, useState} from 'react';
import type {IntegrationConnection} from '#core/models.js';
import {useConnectPosthogMutation} from '#hooks/api/integrations.js';
import {posthogConnectErrorToFormError} from '#posthog-form-errors.js';

const POSTHOG_SETUP_URL = 'https://www.shipfox.io/docs/integrations/posthog/setup';

export interface PosthogConnectModalProps {
  workspaceId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenReplaceApiKey?: (connectionId: string) => void;
  onConnected?: (connection: IntegrationConnection) => void;
}

export function PosthogConnectModal({
  workspaceId,
  open,
  onOpenChange,
  onOpenReplaceApiKey,
  onConnected,
}: PosthogConnectModalProps) {
  const connectPosthog = useConnectPosthogMutation();
  const [projects, setProjects] = useState<Array<{id: string; name: string}> | undefined>();
  const [formError, setFormError] = useState<string | undefined>();
  const [alreadyConnectedId, setAlreadyConnectedId] = useState<string | undefined>();

  const form = useForm({
    defaultValues: {region: 'eu' as PosthogRegion, apiKey: '', projectId: ''},
    onSubmit: async ({value}) => {
      setFormError(undefined);
      setAlreadyConnectedId(undefined);
      try {
        const body = posthogConnectBodySchema.parse({
          region: value.region,
          api_key: value.apiKey.trim(),
          ...(value.projectId ? {project_id: value.projectId} : {}),
        });
        const result = await connectPosthog.mutateAsync({workspaceId, body});
        if (result.status === 'select-project') {
          setProjects(result.projects);
          return;
        }
        onConnected?.(result.connection);
        toast.success('PostHog connected.');
        onOpenChange(false);
      } catch (error) {
        const mapped = posthogConnectErrorToFormError(error);
        if (mapped.kind === 'already-connected') {
          setAlreadyConnectedId(mapped.connectionId);
          return;
        }
        if (mapped.kind === 'field') {
          form.setFieldMeta(mapped.field, (previous) => ({
            ...previous,
            errorMap: {...previous.errorMap, onServer: mapped.message},
          }));
        } else {
          setFormError(mapped.message);
        }
      }
    },
  });

  useEffect(() => {
    if (open) return;
    form.reset();
    setProjects(undefined);
    setFormError(undefined);
    setAlreadyConnectedId(undefined);
  }, [form, open]);

  function handleOpenChange(nextOpen: boolean) {
    if (connectPosthog.isPending && !nextOpen) return;
    onOpenChange(nextOpen);
  }

  function returnToKeyForm() {
    setProjects(undefined);
    setFormError(undefined);
    setAlreadyConnectedId(undefined);
    form.setFieldValue('projectId', '');
  }

  const isSelectingProject = projects !== undefined;
  const showAlreadyConnected = alreadyConnectedId !== undefined;

  return (
    <Modal open={open} onOpenChange={handleOpenChange}>
      <ModalContent aria-describedby={undefined}>
        <ModalTitle className="sr-only">Connect PostHog</ModalTitle>
        <ModalHeader title={isSelectingProject ? 'Choose a PostHog project' : 'Connect PostHog'} />
        {isSelectingProject ? (
          <ProjectPicker
            projects={projects}
            isPending={connectPosthog.isPending}
            onBack={returnToKeyForm}
            onSelect={(projectId) => {
              form.setFieldValue('projectId', projectId);
              void form.handleSubmit();
            }}
          />
        ) : (
          <form
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              event.stopPropagation();
              void form.handleSubmit();
            }}
          >
            <ModalBody className="gap-group">
              {showAlreadyConnected ? (
                <AlreadyConnectedState
                  onReplace={() => {
                    const connectionId = alreadyConnectedId;
                    onOpenChange(false);
                    onOpenReplaceApiKey?.(connectionId);
                  }}
                />
              ) : (
                <>
                  {formError ? (
                    <Callout role="alert" type="error">
                      <CalloutContent>
                        <CalloutTitle>Could not connect PostHog</CalloutTitle>
                        <CalloutDescription>{formError}</CalloutDescription>
                      </CalloutContent>
                    </Callout>
                  ) : null}
                  <form.Field
                    name="region"
                    validators={{
                      onBlur: ({value}) => regionFieldError(value),
                      onSubmit: ({value}) => regionFieldError(value),
                    }}
                  >
                    {(field) => (
                      <FormField label="Region" error={fieldError(field)}>
                        <PosthogRegionSelect
                          value={field.state.value}
                          onValueChange={(value) => field.handleChange(value)}
                          onBlur={field.handleBlur}
                        />
                      </FormField>
                    )}
                  </form.Field>
                  <form.Field
                    name="apiKey"
                    validators={{
                      onBlur: ({value}) => apiKeyFieldError(value),
                      onSubmit: ({value}) => apiKeyFieldError(value),
                    }}
                  >
                    {(field) => (
                      <FormField
                        label="Personal API key"
                        error={fieldError(field)}
                        description={
                          <>
                            Use a dedicated PostHog service user for this key.{' '}
                            <a
                              href={POSTHOG_SETUP_URL}
                              target="_blank"
                              rel="noreferrer noopener"
                              className="text-foreground-highlight-interactive underline"
                            >
                              Read the setup guide
                            </a>
                            .
                          </>
                        }
                      >
                        <FormFieldInput
                          type="password"
                          autoComplete="off"
                          value={field.state.value}
                          onChange={(event) => field.handleChange(event.target.value)}
                          onBlur={field.handleBlur}
                          placeholder="phx_..."
                          disabled={connectPosthog.isPending}
                        />
                      </FormField>
                    )}
                  </form.Field>
                </>
              )}
            </ModalBody>
            <ModalFooter>
              <Button
                type="button"
                variant="secondary"
                disabled={connectPosthog.isPending}
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              {showAlreadyConnected ? null : (
                <Button type="submit" isLoading={connectPosthog.isPending}>
                  Connect
                </Button>
              )}
            </ModalFooter>
          </form>
        )}
      </ModalContent>
    </Modal>
  );
}

function PosthogRegionSelect({
  value,
  onValueChange,
  onBlur,
}: {
  value: PosthogRegion;
  onValueChange: (value: PosthogRegion) => void;
  onBlur: () => void;
}) {
  const wiring = useFormField();
  return (
    <Select
      value={value}
      onValueChange={(next) => {
        onValueChange(next as PosthogRegion);
        onBlur();
      }}
    >
      <SelectTrigger
        id={wiring.id}
        aria-invalid={wiring['aria-invalid']}
        aria-describedby={wiring['aria-describedby']}
        className="w-full"
      >
        <SelectValue placeholder="Select a region" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="us">US Cloud</SelectItem>
        <SelectItem value="eu">EU Cloud</SelectItem>
      </SelectContent>
    </Select>
  );
}

function ProjectPicker({
  projects,
  isPending,
  onBack,
  onSelect,
}: {
  projects: Array<{id: string; name: string}>;
  isPending: boolean;
  onBack: () => void;
  onSelect: (projectId: string) => void;
}) {
  return (
    <>
      <ModalBody className="gap-group">
        <Text size="sm" className="text-foreground-neutral-muted">
          This key can access several projects. Choose the project to connect.
        </Text>
        <RadioGroup
          aria-label="PostHog projects"
          variant="card"
          disabled={isPending}
          onValueChange={onSelect}
        >
          {projects.map((project) => (
            <RadioGroupItem key={project.id} value={project.id}>
              <Text as="span" size="sm" bold>
                {project.name}
              </Text>
              <Text as="span" size="xs" className="text-foreground-neutral-muted">
                {project.id}
              </Text>
            </RadioGroupItem>
          ))}
        </RadioGroup>
      </ModalBody>
      <ModalFooter>
        <Button type="button" variant="secondary" disabled={isPending} onClick={onBack}>
          Back
        </Button>
      </ModalFooter>
    </>
  );
}

function AlreadyConnectedState({onReplace}: {onReplace: () => void}) {
  return (
    <Callout role="alert" type="warning">
      <CalloutContent>
        <CalloutTitle>This project is already connected</CalloutTitle>
        <CalloutDescription>
          Replace the API key on the existing connection if it needs new credentials.
        </CalloutDescription>
        <Button type="button" size="sm" onClick={onReplace}>
          Replace API key
        </Button>
      </CalloutContent>
    </Callout>
  );
}

function regionFieldError(value: string): string | undefined {
  return value === 'us' || value === 'eu' ? undefined : 'Choose a PostHog region.';
}

function apiKeyFieldError(value: string): string | undefined {
  return value.trim().length > 0 ? undefined : 'Personal API key is required.';
}
