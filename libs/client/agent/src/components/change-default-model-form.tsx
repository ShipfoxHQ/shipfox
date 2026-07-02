import type {ModelProviderConfigDto} from '@shipfox/api-agent-dto';
import {Alert, Button, fieldError, ModalBody, ModalFooter, Text} from '@shipfox/react-ui';
import {useForm} from '@tanstack/react-form';
import {useState} from 'react';
import {useUpdateModelProviderDefaultModelMutation} from '#hooks/api/model-providers.js';
import {
  DefaultModelField,
  defaultModelFormValue,
  selectedModelForModelPayload,
} from './default-model-field.js';
import {modelProviderConfigErrorToFormError} from './form-errors.js';
import type {SupportedModelProviderCatalogEntry} from './supported-model-provider-catalog-entry.js';

const CHANGE_DEFAULT_MODEL_FORM_ID = 'model-provider-change-default-model-form';

export function ChangeDefaultModelForm({
  workspaceId,
  entry,
  config,
  onSaved,
}: {
  workspaceId: string;
  entry: SupportedModelProviderCatalogEntry;
  config: ModelProviderConfigDto;
  onSaved: () => void;
}) {
  const updateDefaultModel = useUpdateModelProviderDefaultModelMutation();
  const [formError, setFormError] = useState<string | undefined>();
  const form = useForm({
    defaultValues: {default_model: defaultModelFormValue(config.default_model)},
    onSubmit: async ({value}) => {
      setFormError(undefined);
      try {
        await updateDefaultModel.mutateAsync({
          workspaceId,
          modelProviderId: entry.id,
          body: {default_model: selectedModelForModelPayload(value.default_model)},
        });
        onSaved();
      } catch (error) {
        const mapped = modelProviderConfigErrorToFormError(error);
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
