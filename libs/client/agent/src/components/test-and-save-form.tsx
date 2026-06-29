import type {
  AgentProviderCatalogEntryDto,
  AgentProviderConfigDto,
  SupportedAgentProviderId,
} from '@shipfox/api-agent-dto';
import {
  Alert,
  Button,
  Code,
  FormField,
  FormFieldInput,
  ModalBody,
  ModalFooter,
  Text,
} from '@shipfox/react-ui';
import {useForm} from '@tanstack/react-form';
import {useState} from 'react';
import {useUpsertAgentProviderConfigMutation} from '#hooks/api/agent-providers.js';
import {
  DefaultModelField,
  defaultModelFormValue,
  LATEST_MODEL_VALUE,
  selectedModelForCredentialsPayload,
} from './default-model-field.js';
import {fieldError} from './field-error.js';
import {agentProviderConfigErrorToFormError} from './form-errors.js';

export const AGENT_PROVIDER_TEST_AND_SAVE_FORM_ID = 'agent-provider-test-and-save-form';

export function AgentProviderTestAndSaveForm({
  workspaceId,
  entry,
  existingConfig,
  onSaved,
}: {
  workspaceId: string;
  entry: AgentProviderCatalogEntryDto;
  existingConfig?: AgentProviderConfigDto | undefined;
  onSaved: () => void;
}) {
  const upsertConfig = useUpsertAgentProviderConfigMutation();
  const [formError, setFormError] = useState<string | undefined>();
  const form = useForm({
    defaultValues: defaultFormValues(entry, existingConfig),
    onSubmit: async ({value}) => {
      setFormError(undefined);
      const credentials = Object.fromEntries(
        entry.credential_fields.map((credentialField) => [
          credentialField.key,
          value[credentialField.key]?.trim() ?? '',
        ]),
      );
      const selectedModel = value.default_model ?? LATEST_MODEL_VALUE;
      const defaultModel =
        existingConfig === undefined
          ? selectedModelForCredentialsPayload(selectedModel)
          : undefined;

      try {
        await upsertConfig.mutateAsync({
          workspaceId,
          providerId: entry.id as SupportedAgentProviderId,
          body: {
            ...(defaultModel !== undefined ? {default_model: defaultModel} : {}),
            credentials,
          },
        });
        onSaved();
      } catch (error) {
        const mapped = agentProviderConfigErrorToFormError(error);
        setFormError(mapped.message);
      }
    },
  });

  return (
    <>
      <ModalBody className="gap-16">
        <form
          id={AGENT_PROVIDER_TEST_AND_SAVE_FORM_ID}
          className="flex w-full flex-col gap-14"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void form.handleSubmit();
          }}
        >
          {existingConfig === undefined ? (
            <form.Field
              name="default_model"
              validators={{
                onBlur: ({value}) => (value.trim() ? undefined : 'Default model is required.'),
                onSubmit: ({value}) => (value.trim() ? undefined : 'Default model is required.'),
              }}
            >
              {(field) => (
                <DefaultModelField
                  entry={entry}
                  value={field.state.value}
                  error={fieldError(field)}
                  onChange={(event) => field.handleChange(event.target.value)}
                  onBlur={field.handleBlur}
                />
              )}
            </form.Field>
          ) : null}
          {entry.credential_fields.map((credentialField) => (
            <form.Field
              key={credentialField.key}
              name={credentialField.key}
              validators={{
                onBlur: ({value}) =>
                  value.trim() ? undefined : `${credentialField.label} is required.`,
                onSubmit: ({value}) =>
                  value.trim() ? undefined : `${credentialField.label} is required.`,
              }}
            >
              {(field) => (
                <FormField
                  label={credentialField.label}
                  id={`agent-provider-${entry.id}-${credentialField.key}`}
                  error={fieldError(field)}
                >
                  <FormFieldInput
                    type={credentialField.secret ? 'password' : 'text'}
                    autoComplete="off"
                    value={field.state.value}
                    onChange={(event) => field.handleChange(event.target.value)}
                    onBlur={field.handleBlur}
                  />
                  {existingConfig?.key_fingerprints[credentialField.key] ? (
                    <Text size="sm" className="mt-4 text-foreground-neutral-muted">
                      Current:{' '}
                      <Code as="span" variant="label">
                        {existingConfig.key_fingerprints[credentialField.key]}
                      </Code>
                    </Text>
                  ) : null}
                </FormField>
              )}
            </form.Field>
          ))}
        </form>
        {formError ? (
          <Alert variant="error" animated={false}>
            <div className="flex flex-col gap-8">
              <Text size="sm" bold>
                Could not save provider
              </Text>
              <Text size="sm">{formError}</Text>
            </div>
          </Alert>
        ) : null}
      </ModalBody>
      <ModalFooter>
        <Button
          type="submit"
          form={AGENT_PROVIDER_TEST_AND_SAVE_FORM_ID}
          isLoading={upsertConfig.isPending}
        >
          Test & save
        </Button>
      </ModalFooter>
    </>
  );
}

function defaultFormValues(
  entry: AgentProviderCatalogEntryDto,
  existingConfig: AgentProviderConfigDto | undefined,
): Record<string, string> {
  return {
    default_model: defaultModelFormValue(existingConfig?.default_model),
    ...Object.fromEntries(entry.credential_fields.map((field) => [field.key, ''])),
  };
}
