import {jamReplaceTokenBodySchema} from '@shipfox/api-integration-jam-dto';
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
import {useReplaceJamTokenMutation} from '#hooks/api/integrations.js';
import {jamReplaceErrorToFormError} from '#jam-form-errors.js';
import {JamTokenFieldDescription, jamTokenFieldError} from './jam-setup-link.js';

export interface JamReplaceTokenModalProps {
  workspaceId: string;
  connection: IntegrationConnection | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function JamReplaceTokenModal({
  workspaceId,
  connection,
  open,
  onOpenChange,
}: JamReplaceTokenModalProps) {
  const replaceToken = useReplaceJamTokenMutation();
  const [formError, setFormError] = useState<string | undefined>();
  const form = useForm({
    defaultValues: {token: ''},
    onSubmit: async ({value}) => {
      setFormError(undefined);
      if (!connection) return;
      try {
        const body = jamReplaceTokenBodySchema.parse({token: value.token.trim()});
        await replaceToken.mutateAsync({workspaceId, connectionId: connection.id, body});
        toast.success('Jam token replaced.');
        onOpenChange(false);
      } catch (error) {
        const mapped = jamReplaceErrorToFormError(error);
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
    if (replaceToken.isPending && !nextOpen) return;
    onOpenChange(nextOpen);
  }

  return (
    <Modal open={open && connection !== undefined} onOpenChange={handleOpenChange}>
      <ModalContent aria-describedby={undefined}>
        <ModalTitle className="sr-only">Replace Jam token</ModalTitle>
        <ModalHeader title="Replace Jam token" />
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
              Replace the token for <strong>{connection?.displayName}</strong>. The connection and
              its workflow slug stay the same. The token must come from the same Jam workspace.
            </Text>
            {formError ? (
              <Callout role="alert" type="error">
                <CalloutContent>
                  <CalloutTitle>Could not replace the token</CalloutTitle>
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
                  label="New personal access token"
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
                    disabled={replaceToken.isPending}
                  />
                </FormField>
              )}
            </form.Field>
          </ModalBody>
          <ModalFooter>
            <Button
              type="button"
              variant="secondary"
              disabled={replaceToken.isPending}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" isLoading={replaceToken.isPending}>
              Replace token
            </Button>
          </ModalFooter>
        </form>
      </ModalContent>
    </Modal>
  );
}
