import {posthogReplaceApiKeyBodySchema} from '@shipfox/api-integration-posthog-dto';
import {Button} from '@shipfox/react-ui/button';
import {Callout, CalloutContent, CalloutDescription, CalloutTitle} from '@shipfox/react-ui/callout';
import {FormField, FormFieldInput, fieldError} from '@shipfox/react-ui/form-field';
import {
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from '@shipfox/react-ui/modal';
import {toast} from '@shipfox/react-ui/toast';
import {Text} from '@shipfox/react-ui/typography';
import {useForm} from '@tanstack/react-form';
import {useEffect, useState} from 'react';
import type {IntegrationConnection} from '#core/models.js';
import {useReplacePosthogApiKeyMutation} from '#hooks/api/integrations.js';
import {posthogReplaceErrorToFormError} from '#posthog-form-errors.js';

const POSTHOG_SETUP_URL = 'https://www.shipfox.io/docs/integrations/posthog/setup';

export interface PosthogReplaceApiKeyModalProps {
  workspaceId: string;
  connection: IntegrationConnection | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PosthogReplaceApiKeyModal({
  workspaceId,
  connection,
  open,
  onOpenChange,
}: PosthogReplaceApiKeyModalProps) {
  const replaceApiKey = useReplacePosthogApiKeyMutation();
  const [formError, setFormError] = useState<string | undefined>();
  const form = useForm({
    defaultValues: {apiKey: ''},
    onSubmit: async ({value}) => {
      setFormError(undefined);
      if (!connection) return;
      try {
        const body = posthogReplaceApiKeyBodySchema.parse({api_key: value.apiKey.trim()});
        await replaceApiKey.mutateAsync({
          workspaceId,
          connectionId: connection.id,
          body,
        });
        toast.success('PostHog API key replaced.');
        onOpenChange(false);
      } catch (error) {
        const mapped = posthogReplaceErrorToFormError(error);
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
    setFormError(undefined);
  }, [form, open]);

  function handleOpenChange(nextOpen: boolean) {
    if (replaceApiKey.isPending && !nextOpen) return;
    onOpenChange(nextOpen);
  }

  return (
    <Modal open={open && connection !== undefined} onOpenChange={handleOpenChange}>
      <ModalContent aria-describedby={undefined}>
        <ModalTitle className="sr-only">Replace PostHog API key</ModalTitle>
        <ModalHeader title="Replace PostHog API key" />
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void form.handleSubmit();
          }}
        >
          <ModalBody className="gap-group">
            <Text size="sm" className="text-foreground-neutral-muted">
              Replace the key for <strong>{connection?.displayName}</strong>. The connection and its
              workflow slug stay the same.
            </Text>
            {formError ? (
              <Callout role="alert" type="error">
                <CalloutContent>
                  <CalloutTitle>Could not replace the API key</CalloutTitle>
                  <CalloutDescription>{formError}</CalloutDescription>
                </CalloutContent>
              </Callout>
            ) : null}
            <form.Field
              name="apiKey"
              validators={{
                onBlur: ({value}) => (value.trim() ? undefined : 'Personal API key is required.'),
                onSubmit: ({value}) => (value.trim() ? undefined : 'Personal API key is required.'),
              }}
            >
              {(field) => (
                <FormField
                  label="New personal API key"
                  error={fieldError(field)}
                  description={
                    <>
                      Use a key from a dedicated PostHog service user.{' '}
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
                    disabled={replaceApiKey.isPending}
                  />
                </FormField>
              )}
            </form.Field>
          </ModalBody>
          <ModalFooter>
            <Button
              type="button"
              variant="secondary"
              disabled={replaceApiKey.isPending}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" isLoading={replaceApiKey.isPending}>
              Replace API key
            </Button>
          </ModalFooter>
        </form>
      </ModalContent>
    </Modal>
  );
}
