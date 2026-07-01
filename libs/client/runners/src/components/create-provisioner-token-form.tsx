import type {CreateProvisionerTokenResponseDto} from '@shipfox/api-runners-dto';
import {
  Alert,
  Button,
  Code,
  FormField,
  FormFieldInput,
  fieldError,
  InlineTips,
  InlineTipsContent,
  InlineTipsDescription,
  InlineTipsTitle,
  ModalBody,
  ModalFooter,
  Text,
  useCopyToClipboard,
} from '@shipfox/react-ui';
import {useForm} from '@tanstack/react-form';
import {useQueryClient} from '@tanstack/react-query';
import {useState} from 'react';
import {
  provisionerTokenQueryKeys,
  useCreateProvisionerTokenMutation,
} from '#hooks/api/provisioner-tokens.js';
import {provisionerTokenCreateErrorToFormError} from './provisioner-token-form-errors.js';
import {
  ExpirationSelect,
  expirationHint,
  type TokenExpirationOption,
} from './token-expiration-select.js';

export const CREATE_PROVISIONER_TOKEN_FORM_ID = 'create-provisioner-token-form';

export function CreateProvisionerTokenForm({
  workspaceId,
  onCreated,
}: {
  workspaceId: string;
  onCreated: (token: CreateProvisionerTokenResponseDto) => void;
}) {
  const queryClient = useQueryClient();
  const createToken = useCreateProvisionerTokenMutation();
  const [formError, setFormError] = useState<string | undefined>();

  const form = useForm({
    defaultValues: {name: '', expiration: '86400' as TokenExpirationOption},
    onSubmit: async ({value}) => {
      setFormError(undefined);
      const trimmedName = value.name.trim();
      const body = {
        ...(trimmedName ? {name: trimmedName} : {}),
        ...(value.expiration === 'never' ? {} : {ttl_seconds: Number(value.expiration)}),
      };

      try {
        const token = await createToken.mutateAsync({workspaceId, body});
        await queryClient.invalidateQueries({
          queryKey: provisionerTokenQueryKeys.list(workspaceId),
        });
        onCreated(token);
      } catch (error) {
        const mapped = provisionerTokenCreateErrorToFormError(error);
        setFormError(mapped.message);
      }
    },
  });

  return (
    <>
      <ModalBody className="gap-16">
        <form
          id={CREATE_PROVISIONER_TOKEN_FORM_ID}
          className="flex w-full flex-col gap-8"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void form.handleSubmit();
          }}
        >
          <div className="flex w-full items-end gap-16 max-[640px]:flex-col max-[640px]:items-stretch">
            <form.Field
              name="name"
              validators={{
                onBlur: ({value}) =>
                  value.length <= 80 ? undefined : 'Token name must be 80 characters or fewer.',
              }}
            >
              {(field) => (
                <FormField
                  className="flex-1"
                  label="Token name"
                  id="provisioner-token-name"
                  error={fieldError(field)}
                >
                  <FormFieldInput
                    placeholder="Docker provisioner"
                    maxLength={80}
                    value={field.state.value}
                    onChange={(event) => field.handleChange(event.target.value)}
                    onBlur={field.handleBlur}
                  />
                </FormField>
              )}
            </form.Field>
            <form.Field name="expiration">
              {(field) => (
                <FormField
                  className="flex-1"
                  label="Expires"
                  id="provisioner-token-expiration"
                  error={fieldError(field)}
                >
                  <ExpirationSelect
                    value={field.state.value}
                    onValueChange={(next) => field.handleChange(next)}
                  />
                </FormField>
              )}
            </form.Field>
          </div>
          <form.Subscribe selector={(state) => state.values.expiration}>
            {(expiration) => (
              <Text size="sm" className="text-foreground-neutral-muted">
                {expirationHint(expiration)}
              </Text>
            )}
          </form.Subscribe>
        </form>
        {formError ? (
          <Alert variant="error" animated={false}>
            <div className="flex flex-col gap-8">
              <Text size="sm" bold>
                Could not create token
              </Text>
              <Text size="sm">{formError}</Text>
            </div>
          </Alert>
        ) : null}
      </ModalBody>
      <ModalFooter>
        <Button
          type="submit"
          form={CREATE_PROVISIONER_TOKEN_FORM_ID}
          isLoading={createToken.isPending}
        >
          Create token
        </Button>
      </ModalFooter>
    </>
  );
}

export function CreatedProvisionerTokenPanel({token}: {token: CreateProvisionerTokenResponseDto}) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const {copy} = useCopyToClipboard({
    text: token.raw_token,
    onCopy: () => {
      setCopyState('copied');
      window.setTimeout(() => setCopyState('idle'), 1500);
    },
  });

  async function handleCopy() {
    try {
      await copy();
    } catch {
      setCopyState('failed');
      window.setTimeout(() => setCopyState('idle'), 2500);
    }
  }

  return (
    <InlineTips type="success" variant="secondary" className="items-start">
      <InlineTipsContent className="flex flex-col gap-12">
        <div className="flex flex-col gap-2">
          <InlineTipsTitle className="mb-0">Token created</InlineTipsTitle>
          <InlineTipsDescription>
            Copy this provisioner token now. It will not be shown again.
          </InlineTipsDescription>
        </div>
        <div className="flex items-center gap-8 max-[640px]:flex-col max-[640px]:items-stretch">
          <Code variant="paragraph" className="min-w-0 flex-1 break-all">
            {token.raw_token}
          </Code>
          <Button
            size="sm"
            variant="secondary"
            iconLeft="fileCopyLine"
            onClick={() => void handleCopy()}
          >
            {copyState === 'copied' ? 'Copied' : 'Copy'}
          </Button>
        </div>
        {copyState === 'failed' ? (
          <Text size="sm" className="text-foreground-neutral-muted">
            Copy failed: select and copy manually.
          </Text>
        ) : null}
      </InlineTipsContent>
    </InlineTips>
  );
}
