import type {AgentProviderCatalogEntryDto, AgentProviderConfigDto} from '@shipfox/api-agent-dto';
import {Alert, Button, fieldError, ModalBody, ModalFooter, Text} from '@shipfox/react-ui';
import {useForm} from '@tanstack/react-form';
import {useState} from 'react';
import {useUpdateAgentProviderDefaultModelMutation} from '#hooks/api/agent-providers.js';
import {
  DefaultModelField,
  defaultModelFormValue,
  selectedModelForModelPayload,
} from './default-model-field.js';
import {agentProviderConfigErrorToFormError} from './form-errors.js';

const CHANGE_DEFAULT_MODEL_FORM_ID = 'agent-provider-change-default-model-form';

export function ChangeDefaultModelForm({
  workspaceId,
  entry,
  config,
  onSaved,
}: {
  workspaceId: string;
  entry: AgentProviderCatalogEntryDto;
  config: AgentProviderConfigDto;
  onSaved: () => void;
}) {
  const updateDefaultModel = useUpdateAgentProviderDefaultModelMutation();
  const [formError, setFormError] = useState<string | undefined>();
  const form = useForm({
    defaultValues: {default_model: defaultModelFormValue(config.default_model)},
    onSubmit: async ({value}) => {
      setFormError(undefined);
      try {
        await updateDefaultModel.mutateAsync({
          workspaceId,
          providerId: config.provider_id,
          body: {default_model: selectedModelForModelPayload(value.default_model)},
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
          id={CHANGE_DEFAULT_MODEL_FORM_ID}
          className="flex w-full flex-col gap-14"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void form.handleSubmit();
          }}
        >
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
        </form>
        {formError ? (
          <Alert variant="error" animated={false}>
            <div className="flex flex-col gap-8">
              <Text size="sm" bold>
                Could not save default model
              </Text>
              <Text size="sm">{formError}</Text>
            </div>
          </Alert>
        ) : null}
      </ModalBody>
      <ModalFooter>
        <Button
          type="submit"
          form={CHANGE_DEFAULT_MODEL_FORM_ID}
          isLoading={updateDefaultModel.isPending}
        >
          Save model
        </Button>
      </ModalFooter>
    </>
  );
}
