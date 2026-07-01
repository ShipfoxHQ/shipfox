import {slugifyConnectionSlug} from '@shipfox/api-integration-core-dto';
import {
  createWebhookConnectionBodySchema,
  WEBHOOK_RESERVED_SLUGS,
  type WebhookConnectionDto,
  webhookSlugSchema,
} from '@shipfox/api-integration-webhook-dto';
import {displayNameFieldError} from '@shipfox/client-ui';
import {
  Alert,
  Button,
  Code,
  FormField,
  FormFieldInput,
  fieldError,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  Text,
  toast,
} from '@shipfox/react-ui';
import {useForm} from '@tanstack/react-form';
import type {ReactNode} from 'react';
import {useEffect, useRef, useState} from 'react';
import {useCreateWebhookConnectionMutation} from '#hooks/api/webhook-connections.js';
import {CopyableValue} from './copyable-value.js';
import {webhookCreateErrorToFormError} from './webhook-form-errors.js';

interface WebhookCreateModalProps {
  workspaceId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function WebhookCreateModal({workspaceId, open, onOpenChange}: WebhookCreateModalProps) {
  const createWebhook = useCreateWebhookConnectionMutation();
  const [formError, setFormError] = useState<string | undefined>();
  const [slugTouched, setSlugTouched] = useState(false);
  const [createdConnection, setCreatedConnection] = useState<WebhookConnectionDto | undefined>();
  const nameInputRef = useRef<HTMLInputElement | null>(null);

  const form = useForm({
    defaultValues: {name: '', slug: ''},
    onSubmit: async ({value}) => {
      setFormError(undefined);
      try {
        const body = createWebhookConnectionBodySchema.parse({
          workspace_id: workspaceId,
          name: value.name.trim(),
          slug: value.slug.trim(),
        });
        const connection = await createWebhook.mutateAsync(body);
        setCreatedConnection(connection);
        toast.success('Webhook created.');
      } catch (error) {
        const mapped = webhookCreateErrorToFormError(error);
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

  useEffect(() => {
    if (!open) {
      setCreatedConnection(undefined);
      setFormError(undefined);
      setSlugTouched(false);
      form.reset();
      return;
    }
    requestAnimationFrame(() => nameInputRef.current?.focus());
  }, [form, open]);

  useEffect(() => {
    if (slugTouched) return;
    const nextSlug = form.state.values.name.trim()
      ? slugifyConnectionSlug(form.state.values.name, {fallback: 'webhook'})
      : '';
    if (form.state.values.slug !== nextSlug) {
      form.setFieldValue('slug', nextSlug);
    }
  }, [form, form.state.values.name, form.state.values.slug, slugTouched]);

  const title = createdConnection ? 'Webhook created' : 'Add webhook';
  const handleOpenChange = (nextOpen: boolean) => {
    if (createWebhook.isPending && !nextOpen) return;
    onOpenChange(nextOpen);
  };

  return (
    <Modal open={open} onOpenChange={handleOpenChange}>
      <ModalContent aria-describedby={undefined}>
        <ModalTitle className="sr-only">{title}</ModalTitle>
        <ModalHeader title={title} showClose={!createWebhook.isPending} />
        {createdConnection ? (
          <WebhookCreateSuccessContent
            connection={createdConnection}
            onDone={() => onOpenChange(false)}
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
            <ModalBody className="gap-16">
              <Text size="sm" className="text-foreground-neutral-muted">
                Create a named inbound webhook URL for this workspace.
              </Text>
              {formError ? <Alert variant="error">{formError}</Alert> : null}
              <form.Field
                name="name"
                validators={{
                  onBlur: ({value}) => webhookNameFieldError(value),
                  onSubmit: ({value}) => webhookNameFieldError(value),
                }}
              >
                {(field) => (
                  <FormField label="Name" id="webhook-name" error={fieldError(field)}>
                    <FormFieldInput
                      ref={nameInputRef}
                      name="name"
                      value={field.state.value}
                      onChange={(event) => field.handleChange(event.target.value)}
                      onBlur={field.handleBlur}
                      placeholder="Stripe production"
                      disabled={createWebhook.isPending}
                    />
                  </FormField>
                )}
              </form.Field>
              <form.Field
                name="slug"
                validators={{
                  onBlur: ({value}) => webhookSlugFieldError(value),
                  onSubmit: ({value}) => webhookSlugFieldError(value),
                }}
              >
                {(field) => (
                  <FormField label="Slug" id="webhook-slug" error={fieldError(field)}>
                    <FormFieldInput
                      name="slug"
                      value={field.state.value}
                      onChange={(event) => {
                        setSlugTouched(true);
                        field.handleChange(event.target.value);
                      }}
                      onBlur={field.handleBlur}
                      placeholder="stripe-production"
                      disabled={createWebhook.isPending}
                    />
                    <Text size="sm" className="text-foreground-neutral-muted">
                      Use as{' '}
                      <Code as="span">source: {field.state.value || 'stripe-production'}</Code> in
                      workflow triggers.
                    </Text>
                  </FormField>
                )}
              </form.Field>
            </ModalBody>
            <ModalFooter>
              <Button
                type="button"
                variant="secondary"
                disabled={createWebhook.isPending}
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button type="submit" isLoading={createWebhook.isPending}>
                Create
              </Button>
            </ModalFooter>
          </form>
        )}
      </ModalContent>
    </Modal>
  );
}

export function WebhookCreateSuccessContent({
  connection,
  onDone,
}: {
  connection: WebhookConnectionDto;
  onDone: () => void;
}) {
  return (
    <>
      <ModalBody className="gap-20">
        <Text size="sm" className="text-foreground-neutral-muted">
          Copy these values now, or reopen them later from Installed integrations, then Manage.
        </Text>
        <Artifact label="Inbound URL">
          <CopyableValue
            label="inbound URL"
            value={connection.inbound_url}
            note="Anyone with this URL can trigger your workflow."
          />
        </Artifact>
        <Artifact label="Workflow source">
          <CopyableValue
            label="workflow source"
            value={connection.slug}
            note="Paste as source: in your workflow trigger."
          />
        </Artifact>
      </ModalBody>
      <ModalFooter>
        <Button type="button" onClick={onDone}>
          Done
        </Button>
      </ModalFooter>
    </>
  );
}

function Artifact({label, children}: {label: string; children: ReactNode}) {
  return (
    <div className="flex w-full min-w-0 flex-col gap-8">
      <Text size="sm" bold>
        {label}
      </Text>
      {children}
    </div>
  );
}

function webhookNameFieldError(value: string): string | undefined {
  return displayNameFieldError(
    value.trim(),
    'Webhook name',
    createWebhookConnectionBodySchema.shape.name,
  );
}

function webhookSlugFieldError(value: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) return 'Slug is required.';
  if (WEBHOOK_RESERVED_SLUGS.includes(trimmed as (typeof WEBHOOK_RESERVED_SLUGS)[number])) {
    return 'That slug is reserved.';
  }
  if (webhookSlugSchema.safeParse(trimmed).success) return undefined;
  return 'Use lowercase letters, numbers, hyphens, or underscores.';
}
