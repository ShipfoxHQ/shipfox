import {isSensitiveSecretName} from '@shipfox/api-secrets-dto';
import {
  Alert,
  Button,
  FormField,
  FormFieldInput,
  FormFieldTextarea,
  fieldError,
  Text,
} from '@shipfox/react-ui';
import {useForm} from '@tanstack/react-form';
import {useState} from 'react';
import {usePutVariableMutation} from '#hooks/api/variables.js';
import {secretsErrorToFormError} from './form-errors.js';
import {FormBody, FormFooter} from './form-shell.js';
import {STORE_KEY_HELP, validateStoreKey} from './store-key.js';

export const VARIABLE_FORM_ID = 'variable-form';

export function VariableForm({
  workspaceId,
  mode,
  existingKey,
  existingValue,
  onSaved,
  onCancel,
}: {
  workspaceId: string;
  mode: 'create' | 'edit';
  existingKey?: string | undefined;
  existingValue?: string | undefined;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const putVariable = usePutVariableMutation();
  const [formError, setFormError] = useState<string | undefined>();

  const form = useForm({
    defaultValues: {key: existingKey ?? '', value: existingValue ?? ''},
    onSubmit: async ({value}) => {
      setFormError(undefined);
      try {
        await putVariable.mutateAsync({workspaceId, key: value.key, body: {value: value.value}});
        onSaved();
      } catch (error) {
        const mapped = secretsErrorToFormError(error);
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

  return (
    <>
      <FormBody>
        <form
          id={VARIABLE_FORM_ID}
          className="flex w-full flex-col gap-16"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void form.handleSubmit();
          }}
        >
          <form.Field
            name="key"
            validators={{
              onBlur: ({value}) => validateStoreKey(value),
              onSubmit: ({value}) => validateStoreKey(value),
            }}
          >
            {(field) => (
              <FormField
                label="Name"
                id="variable-key"
                description={STORE_KEY_HELP}
                error={fieldError(field)}
              >
                <FormFieldInput
                  className="font-code"
                  autoComplete="off"
                  spellCheck={false}
                  disabled={mode === 'edit'}
                  placeholder="LOG_LEVEL"
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.target.value.toUpperCase())}
                  onBlur={field.handleBlur}
                />
                {isSensitiveSecretName(field.state.value) ? (
                  <Alert variant="warning" animated={false}>
                    <Text size="sm" aria-live="polite">
                      Variables are stored in plaintext and are not redacted from logs. Store this
                      as a Secret instead.
                    </Text>
                  </Alert>
                ) : null}
              </FormField>
            )}
          </form.Field>

          <form.Field name="value">
            {(field) => (
              <FormField label="Value" id="variable-value" error={fieldError(field)}>
                <FormFieldTextarea
                  className="font-code"
                  autoComplete="off"
                  spellCheck={false}
                  rows={3}
                  placeholder="debug"
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.target.value)}
                  onBlur={field.handleBlur}
                />
              </FormField>
            )}
          </form.Field>
        </form>
        {formError ? (
          <Alert variant="error" animated={false}>
            <Text size="sm">{formError}</Text>
          </Alert>
        ) : null}
      </FormBody>
      <FormFooter>
        <Button variant="secondary" type="button" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" form={VARIABLE_FORM_ID} isLoading={putVariable.isPending}>
          {mode === 'edit' ? 'Update variable' : 'Add variable'}
        </Button>
      </FormFooter>
    </>
  );
}
