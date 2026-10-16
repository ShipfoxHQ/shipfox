import {jamConnectBodySchema} from '@shipfox/api-integration-jam-dto';
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
import type {IntegrationConnection} from '#core/models.js';
import {useConnectJamMutation} from '#hooks/api/integrations.js';
import {jamConnectErrorToFormError} from '#jam-form-errors.js';
import {JamTokenFieldDescription, jamTokenFieldError} from './jam-setup-link.js';

const jamConnectInputSchema = jamConnectBodySchema.omit({workspace_id: true});

export interface JamConnectModalProps {
  workspaceId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenReplaceToken?: (connectionId: string) => void;
  onConnected?: (connection: IntegrationConnection) => void;
}

export function JamConnectModal({
  workspaceId,
  open,
  onOpenChange,
  onOpenReplaceToken,
  onConnected,
}: JamConnectModalProps) {
  const connectJam = useConnectJamMutation();
  const [formError, setFormError] = useState<string | undefined>();
  const [alreadyConnectedId, setAlreadyConnectedId] = useState<string | undefined>();

  const form = useForm({
    defaultValues: {token: ''},
    onSubmit: async ({value}) => {
      setFormError(undefined);
      setAlreadyConnectedId(undefined);
      try {
        const body = jamConnectInputSchema.parse({token: value.token.trim()});
        const connection = await connectJam.mutateAsync({workspaceId, body});
        onConnected?.(connection);
        toast.success('Jam connected.');
        onOpenChange(false);
      } catch (error) {
        const mapped = jamConnectErrorToFormError(error);
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
    if (connectJam.isPending && !nextOpen) return;
    onOpenChange(nextOpen);
  }

  const showAlreadyConnected = alreadyConnectedId !== undefined;

  return (
    <Modal open={open} onOpenChange={handleOpenChange}>
      <ModalContent aria-describedby={undefined}>
        <ModalTitle className="sr-only">Connect Jam</ModalTitle>
        <ModalHeader title="Connect Jam" />
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
              <Callout role="alert" type="warning">
                <CalloutContent>
                  <CalloutTitle>This Jam workspace is already connected</CalloutTitle>
                  <CalloutDescription>
                    Replace the token on the existing connection if it needs new credentials.
                  </CalloutDescription>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => {
                      onOpenChange(false);
                      onOpenReplaceToken?.(alreadyConnectedId);
                    }}
                  >
                    Replace token
                  </Button>
                </CalloutContent>
              </Callout>
            ) : (
              <>
                {formError ? (
                  <Callout role="alert" type="error">
                    <CalloutContent>
                      <CalloutTitle>Could not connect Jam</CalloutTitle>
                      <CalloutDescription>{formError}</CalloutDescription>
                    </CalloutContent>
                  </Callout>
                ) : null}
                <form.Field
                  name="token"
                  validators={{
                    onBlur: ({value}) => jamTokenFieldError(value),
                    onSubmit: ({value}) => jamTokenFieldError(value),
                  }}
                >
                  {(field) => (
                    <FormField
                      label="Personal access token"
                      error={fieldError(field)}
                      description={<JamTokenFieldDescription />}
                    >
                      <FormFieldInput
                        type="password"
                        autoComplete="off"
                        value={field.state.value}
                        onChange={(event) => field.handleChange(event.target.value)}
                        onBlur={field.handleBlur}
                        placeholder="jam_pat_..."
                        disabled={connectJam.isPending}
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
              disabled={connectJam.isPending}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            {showAlreadyConnected ? null : (
              <Button type="submit" isLoading={connectJam.isPending}>
                Connect
              </Button>
            )}
          </ModalFooter>
        </form>
      </ModalContent>
    </Modal>
  );
}
