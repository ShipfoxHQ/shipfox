import {claapConnectBodySchema} from '@shipfox/api-integration-claap-dto';
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
import {useForm} from '@tanstack/react-form';
import {useEffect, useState} from 'react';
import {claapConnectErrorToFormError} from '#claap-form-errors.js';
import type {IntegrationConnection} from '#core/models.js';
import {useConnectClaapMutation} from '#hooks/api/integrations.js';
import {apiKeyFieldError, CLAAP_SETUP_URL} from './claap-api-key.js';

const claapConnectInputSchema = claapConnectBodySchema.omit({workspace_id: true});

export interface ClaapConnectModalProps {
  workspaceId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenReplaceApiKey?: (connectionId: string) => void;
  onConnected?: (connection: IntegrationConnection) => void;
}

export function ClaapConnectModal({
  workspaceId,
  open,
  onOpenChange,
  onOpenReplaceApiKey,
  onConnected,
}: ClaapConnectModalProps) {
  const connectClaap = useConnectClaapMutation();
  const [formError, setFormError] = useState<string | undefined>();
  const [alreadyConnectedId, setAlreadyConnectedId] = useState<string | undefined>();

  const form = useForm({
    defaultValues: {apiKey: ''},
    onSubmit: async ({value}) => {
      setFormError(undefined);
      setAlreadyConnectedId(undefined);
      try {
        const body = claapConnectInputSchema.parse({api_key: value.apiKey.trim()});
        const connection = await connectClaap.mutateAsync({workspaceId, body});
        onConnected?.(connection);
        toast.success('Claap connected.');
        onOpenChange(false);
      } catch (error) {
        const mapped = claapConnectErrorToFormError(error);
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
    setFormError(undefined);
    setAlreadyConnectedId(undefined);
  }, [form, open]);

  function handleOpenChange(nextOpen: boolean) {
    if (connectClaap.isPending && !nextOpen) return;
    onOpenChange(nextOpen);
  }

  const showAlreadyConnected = alreadyConnectedId !== undefined;

  return (
    <Modal open={open} onOpenChange={handleOpenChange}>
      <ModalContent aria-describedby={undefined}>
        <ModalTitle className="sr-only">Connect Claap</ModalTitle>
        <ModalHeader title="Connect Claap" />
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
                      <CalloutTitle>Could not connect Claap</CalloutTitle>
                      <CalloutDescription>{formError}</CalloutDescription>
                    </CalloutContent>
                  </Callout>
                ) : null}
                <form.Field
                  name="apiKey"
                  validators={{
                    onBlur: ({value}) => apiKeyFieldError(value),
                    onSubmit: ({value}) => apiKeyFieldError(value),
                  }}
                >
                  {(field) => (
                    <FormField
                      label="API key"
                      error={fieldError(field)}
                      description={
                        <>
                          A Claap Admin or Owner creates the key in Settings &gt; API &amp;
                          Webhooks.{' '}
                          <a
                            href={CLAAP_SETUP_URL}
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
                        placeholder="cla_..."
                        disabled={connectClaap.isPending}
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
              disabled={connectClaap.isPending}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            {showAlreadyConnected ? null : (
              <Button type="submit" isLoading={connectClaap.isPending}>
                Connect
              </Button>
            )}
          </ModalFooter>
        </form>
      </ModalContent>
    </Modal>
  );
}

function AlreadyConnectedState({onReplace}: {onReplace: () => void}) {
  return (
    <Callout role="alert" type="warning">
      <CalloutContent>
        <CalloutTitle>This Claap workspace is already connected</CalloutTitle>
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
