import type {
  CreateCustomModelProviderBodyDto,
  CustomAgentModelDto,
  CustomModelProviderConfigDto,
  DiscoverCustomModelProviderModelsBodyDto,
  DiscoverCustomModelProviderModelsBySlugBodyDto,
  ModelProviderApi,
  UpdateCustomModelProviderBodyDto,
} from '@shipfox/api-agent-dto';

type CreateHeaderRequest = NonNullable<CreateCustomModelProviderBodyDto['headers']>[number];
type UpdateHeaderRequest = NonNullable<UpdateCustomModelProviderBodyDto['headers']>[number];

export interface CustomModelProviderHeaderFormValue {
  client_id: string;
  name: string;
  value: string;
  secret: boolean;
  hasStoredValue: boolean;
  storedName: string;
}

export interface CustomModelProviderModelFormValue {
  client_id: string;
  id: string;
  label: string;
  context_window: string;
  max_output_tokens: string;
  input_image: boolean;
  reasoning: boolean;
}

export interface CustomModelProviderFormValues {
  slug: string;
  display_name: string;
  api: ModelProviderApi;
  base_url: string;
  api_key: string;
  headers: CustomModelProviderHeaderFormValue[];
  models: CustomModelProviderModelFormValue[];
  default_model: string;
}

export function createCustomModelProviderFormValues(): CustomModelProviderFormValues {
  return {
    slug: '',
    display_name: '',
    api: 'openai-completions',
    base_url: '',
    api_key: '',
    headers: [],
    models: [
      {
        client_id: createFormRowId(),
        id: '',
        label: '',
        context_window: '',
        max_output_tokens: '',
        input_image: false,
        reasoning: false,
      },
    ],
    default_model: '',
  };
}

export function editCustomModelProviderFormValues(
  config: CustomModelProviderConfigDto,
): CustomModelProviderFormValues {
  return {
    slug: config.provider_id,
    display_name: config.display_name,
    api: config.api,
    base_url: config.base_url,
    api_key: '',
    headers: [
      ...config.headers.map((header) => ({
        client_id: createFormRowId(),
        name: header.name,
        value: header.value,
        secret: false,
        hasStoredValue: false,
        storedName: header.name,
      })),
      ...config.secret_header_names.map((name) => ({
        client_id: createFormRowId(),
        name,
        value: '',
        secret: true,
        hasStoredValue: true,
        storedName: normalizeHeaderName(name),
      })),
    ],
    models: config.models.map(modelFormValue),
    default_model: config.default_model ?? '',
  };
}

export function buildCreateCustomModelProviderBody(
  values: CustomModelProviderFormValues,
): CreateCustomModelProviderBodyDto {
  return {
    slug: values.slug.trim(),
    display_name: values.display_name.trim(),
    api: values.api,
    base_url: values.base_url.trim(),
    ...(values.api_key.trim() ? {api_key: values.api_key.trim()} : {}),
    ...(requestHeaders(values.headers).length > 0 ? {headers: requestHeaders(values.headers)} : {}),
    models: requestModels(values.models),
    ...(values.default_model.trim() ? {default_model: values.default_model.trim()} : {}),
  };
}

export function buildUpdateCustomModelProviderBody(
  config: CustomModelProviderConfigDto,
  values: CustomModelProviderFormValues,
): UpdateCustomModelProviderBodyDto {
  const body: UpdateCustomModelProviderBodyDto = {};
  if (values.display_name.trim() !== config.display_name)
    body.display_name = values.display_name.trim();
  if (values.api !== config.api) body.api = values.api;
  if (values.base_url.trim() !== config.base_url) body.base_url = values.base_url.trim();
  if (values.api_key.trim()) body.api_key = values.api_key.trim();
  if (customHeadersDirty(config, values.headers)) body.headers = updateHeaders(values.headers);
  if (customModelsDirty(config, values.models)) body.models = requestModels(values.models);

  const nextDefault = values.default_model.trim() || null;
  if (nextDefault !== config.default_model) body.default_model = nextDefault;
  return body;
}

export function customHeadersDirty(
  config: CustomModelProviderConfigDto,
  headers: CustomModelProviderHeaderFormValue[],
): boolean {
  return (
    JSON.stringify(updateHeaders(headers)) !==
    JSON.stringify([
      ...config.headers.map((header) => ({
        name: normalizeHeaderName(header.name),
        value: header.value,
        secret: false,
      })),
      ...config.secret_header_names.map((name) => ({
        name: normalizeHeaderName(name),
        secret: true,
        keep: true,
      })),
    ])
  );
}

export function customModelsDirty(
  config: CustomModelProviderConfigDto,
  models: CustomModelProviderModelFormValue[],
): boolean {
  return JSON.stringify(requestModels(models)) !== JSON.stringify(config.models);
}

export function buildDiscoverModelsBody(
  values: CustomModelProviderFormValues,
): DiscoverCustomModelProviderModelsBodyDto {
  return {
    api: values.api,
    base_url: values.base_url.trim(),
    ...(values.api_key.trim() ? {api_key: values.api_key.trim()} : {}),
    ...(requestHeaders(values.headers).length > 0
      ? {
          headers: requestHeaders(values.headers).map(({name, value}) => ({
            name,
            value,
          })),
        }
      : {}),
  };
}

export function buildDiscoverModelsBySlugBody(
  config: CustomModelProviderConfigDto,
  values: CustomModelProviderFormValues,
): DiscoverCustomModelProviderModelsBySlugBodyDto {
  const body: DiscoverCustomModelProviderModelsBySlugBodyDto = {};
  if (values.api !== config.api) body.api = values.api;
  if (values.base_url.trim() !== config.base_url) body.base_url = values.base_url.trim();
  if (values.api_key.trim()) body.api_key = values.api_key.trim();
  body.headers = updateHeaders(values.headers);
  return body;
}

export function formatBaseUrlHost(baseUrl: string): string {
  try {
    const url = new URL(baseUrl);
    return url.host;
  } catch {
    return baseUrl;
  }
}

export function createFormRowId(): string {
  return crypto.randomUUID();
}

function updateHeaders(headers: CustomModelProviderHeaderFormValue[]): UpdateHeaderRequest[] {
  const result: UpdateHeaderRequest[] = [];
  for (const header of headers) {
    const name = normalizeHeaderName(header.name);
    if (!name) continue;
    if (
      header.secret &&
      header.hasStoredValue &&
      header.value.trim() === '' &&
      name === header.storedName
    ) {
      result.push({name, secret: true, keep: true});
      continue;
    }
    result.push({name, value: header.value.trim(), secret: header.secret});
  }
  return result;
}

function requestHeaders(headers: CustomModelProviderHeaderFormValue[]): CreateHeaderRequest[] {
  return updateHeaders(headers).flatMap((header) =>
    'value' in header && header.value
      ? [{name: header.name, value: header.value, secret: header.secret}]
      : [],
  );
}

function requestModels(models: CustomModelProviderModelFormValue[]): CustomAgentModelDto[] {
  return models.flatMap((model) => {
    const id = model.id.trim();
    const label = model.label.trim();
    if (!id || !label) return [];
    return [
      {
        id,
        label,
        ...(model.context_window.trim() ? {context_window: Number(model.context_window)} : {}),
        ...(model.max_output_tokens.trim()
          ? {max_output_tokens: Number(model.max_output_tokens)}
          : {}),
        ...(model.input_image ? {input_image: true} : {}),
        ...(model.reasoning ? {reasoning: true} : {}),
      },
    ];
  });
}

function modelFormValue(model: CustomAgentModelDto): CustomModelProviderModelFormValue {
  return {
    client_id: createFormRowId(),
    id: model.id,
    label: model.label,
    context_window: model.context_window?.toString() ?? '',
    max_output_tokens: model.max_output_tokens?.toString() ?? '',
    input_image: model.input_image ?? false,
    reasoning: model.reasoning ?? false,
  };
}

function normalizeHeaderName(name: string): string {
  return name.trim().toLowerCase();
}
