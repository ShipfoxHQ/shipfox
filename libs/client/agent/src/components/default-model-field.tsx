import type {ModelProviderCatalogEntryDto} from '@shipfox/api-agent-dto';
import {cn, FormField, useFormField} from '@shipfox/react-ui';
import type {ComponentProps, ReactNode} from 'react';

export const LATEST_MODEL_VALUE = '__latest__';

export function DefaultModelField({
  entry,
  value,
  error,
  children,
  onChange,
  onBlur,
}: {
  entry: ModelProviderCatalogEntryDto;
  value: string;
  error: string | undefined;
  children?: ReactNode;
  onChange: ComponentProps<'select'>['onChange'];
  onBlur: ComponentProps<'select'>['onBlur'];
}) {
  return (
    <FormField
      label="Default model"
      id={`model-provider-${entry.id}-default-model`}
      error={error}
      description={defaultModelDescription(entry, value)}
    >
      <FormFieldSelect value={value} onChange={onChange} onBlur={onBlur}>
        <option value={LATEST_MODEL_VALUE}>Latest</option>
        {entry.models.map((model) => (
          <option key={model.id} value={model.id}>
            {model.label}
          </option>
        ))}
      </FormFieldSelect>
      {children}
    </FormField>
  );
}

export function defaultModelFormValue(defaultModel: string | null | undefined): string {
  return defaultModel ?? LATEST_MODEL_VALUE;
}

export function selectedModelForCredentialsPayload(selectedModel: string): string | null {
  return selectedModel === LATEST_MODEL_VALUE ? null : selectedModel.trim();
}

export function selectedModelForModelPayload(selectedModel: string): string | null {
  return selectedModel === LATEST_MODEL_VALUE ? null : selectedModel.trim();
}

function defaultModelLabel(entry: ModelProviderCatalogEntryDto): string {
  const defaultModel = entry.default_model ?? entry.models[0]?.id ?? '';
  return entry.models.find((model) => model.id === defaultModel)?.label ?? defaultModel;
}

function defaultModelDescription(
  entry: ModelProviderCatalogEntryDto,
  selectedModel: string | undefined,
): string | undefined {
  if (selectedModel === LATEST_MODEL_VALUE) {
    return `Latest follows the model provider catalog default. Currently resolves to ${defaultModelLabel(entry)}.`;
  }
  if (!selectedModel) return undefined;
  return selectedModel;
}

function FormFieldSelect({className, ...props}: ComponentProps<'select'>) {
  const wiring = useFormField();
  return (
    <select
      className={cn(
        'w-full min-w-0 rounded-6 bg-background-field-base px-8 py-6 text-sm leading-20 text-foreground-neutral-base shadow-button-neutral outline-none transition-[color,box-shadow]',
        'hover:bg-background-field-hover focus-visible:shadow-border-interactive-with-active disabled:cursor-not-allowed disabled:bg-background-neutral-disabled disabled:text-foreground-neutral-disabled',
        'aria-invalid:shadow-border-error',
        className,
      )}
      {...props}
      {...wiring}
    />
  );
}
