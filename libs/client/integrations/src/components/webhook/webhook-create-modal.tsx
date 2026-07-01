import type {IntegrationConnectionDto} from '@shipfox/api-integration-core-dto';
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
import {useEffect, useRef, useState} from 'react';
import {useCreateWebhookConnectionMutation} from '#hooks/api/webhook-connections.js';
import {webhookCreateErrorToFormError} from './webhook-form-errors.js';

interface WebhookCreateModalProps {
  workspaceId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (connection: IntegrationConnectionDto) => void;
}

export function WebhookCreateModal({
  workspaceId,
  open,
  onOpenChange,
  onCreated,
}: WebhookCreateModalProps) {
  const createWebhook = useCreateWebhookConnectionMutation();
  const [formError, setFormError] = useState<string | undefined>();
  const [hasManualSlug, setHasManualSlug] = useState(false);
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
        onCreated(toIntegrationConnection(connection));
        toast.success('Webhook created.');
        onOpenChange(false);
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
      setFormError(undefined);
      setHasManualSlug(false);
      form.reset();
      return;
    }
    requestAnimationFrame(() => nameInputRef.current?.focus());
  }, [form, open]);

  const handleOpenChange = (nextOpen: boolean) => {
    if (createWebhook.isPending && !nextOpen) return;
    onOpenChange(nextOpen);
  };

  return (
    <Modal open={open} onOpenChange={handleOpenChange}>
      <ModalContent aria-describedby={undefined}>
        <ModalTitle className="sr-only">Add webhook</ModalTitle>
        <ModalHeader title="Add webhook" showClose={!createWebhook.isPending} />
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
                <FormField
                  label="Name"
                  id="webhook-name"
                  error={fieldError(field)}
                  className="w-full"
                >
                  <FormFieldInput
                    ref={nameInputRef}
                    name="name"
                    value={field.state.value}
                    onChange={(event) => {
                      const nextName = event.target.value;
                      field.handleChange(nextName);
                      if (!hasManualSlug) {
                        form.setFieldValue(
                          'slug',
                          nextName.trim() ? suggestWebhookSlug(nextName) : '',
                        );
                      }
                    }}
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
                <FormField
                  label="Slug"
                  id="webhook-slug"
                  error={fieldError(field)}
                  className="w-full"
                >
                  <FormFieldInput
                    name="slug"
                    value={field.state.value}
                    onChange={(event) => {
                      const nextSlug = event.target.value;
                      setHasManualSlug(nextSlug.trim().length > 0);
                      field.handleChange(nextSlug);
                      if (nextSlug.trim().length === 0 && form.state.values.name.trim()) {
                        form.setFieldValue('slug', suggestWebhookSlug(form.state.values.name));
                      }
                    }}
                    onBlur={field.handleBlur}
                    placeholder="webhook-stripe-production"
                    disabled={createWebhook.isPending}
                  />
                  <Text size="sm" className="text-foreground-neutral-muted">
                    Reference in workflows with{' '}
                    <Code as="span">
                      source: {field.state.value || 'webhook-stripe-production'}
                    </Code>
                    .
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
      </ModalContent>
    </Modal>
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

function suggestWebhookSlug(name: string): string {
  const prefix = 'webhook';
  const suffix = name
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-+|-+$/g, '')
    .slice(0, 100 - prefix.length - 1)
    .replaceAll(/-+$/g, '');

  return suffix ? `${prefix}-${suffix}` : prefix;
}

function toIntegrationConnection(connection: WebhookConnectionDto): IntegrationConnectionDto {
  return {
    id: connection.id,
    workspace_id: connection.workspace_id,
    provider: 'webhook',
    external_account_id: connection.slug,
    slug: connection.slug,
    display_name: connection.name,
    lifecycle_status: connection.lifecycle_status,
    capabilities: [],
    created_at: connection.created_at,
    updated_at: connection.updated_at,
  };
}
