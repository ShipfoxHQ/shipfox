import type {
  AgentModel,
  CreateCustomProviderCommand,
  CustomProviderConfig,
  DiscoverProviderModelsCommand,
  ProviderApi,
  UpdateCustomProviderCommand,
} from '#core/models.js';

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
  api: ProviderApi;
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
  config: CustomProviderConfig,
): CustomModelProviderFormValues {
  return {
    slug: config.providerId,
    display_name: config.displayName,
    api: config.api,
    base_url: config.baseUrl,
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
      ...config.secretHeaderNames.map((name) => ({
        client_id: createFormRowId(),
        name,
        value: '',
        secret: true,
        hasStoredValue: true,
        storedName: normalizeHeaderName(name),
      })),
    ],
    models: config.models.map(modelFormValue),
    default_model: config.defaultModel ?? '',
  };
}

export function buildCreateCustomModelProviderBody(
  values: CustomModelProviderFormValues,
): CreateCustomProviderCommand {
  return {
    slug: values.slug.trim(),
    displayName: values.display_name.trim(),
    api: values.api,
    baseUrl: values.base_url.trim(),
    ...(values.api_key.trim() ? {apiKey: values.api_key.trim()} : {}),
    ...(requestHeaders(values.headers).length > 0 ? {headers: requestHeaders(values.headers)} : {}),
    models: requestModels(values.models),
    ...(values.default_model.trim() ? {defaultModel: values.default_model.trim()} : {}),
  };
}

export function buildUpdateCustomModelProviderBody(
  config: CustomProviderConfig,
  values: CustomModelProviderFormValues,
): UpdateCustomProviderCommand {
  const body: UpdateCustomProviderCommand = {};
  if (values.display_name.trim() !== config.displayName)
    body.displayName = values.display_name.trim();
  if (values.api !== config.api) body.api = values.api;
  if (values.base_url.trim() !== config.baseUrl) body.baseUrl = values.base_url.trim();
  if (values.api_key.trim()) body.apiKey = values.api_key.trim();
  if (customHeadersDirty(config, values.headers)) body.headers = updateHeaders(values.headers);
  if (customModelsDirty(config, values.models)) body.models = requestModels(values.models);

  const nextDefault = values.default_model.trim() || null;
  if (nextDefault !== config.defaultModel) body.defaultModel = nextDefault;
  return body;
}

export function customHeadersDirty(
  config: CustomProviderConfig,
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
      ...config.secretHeaderNames.map((name) => ({
        name: normalizeHeaderName(name),
        secret: true,
        keep: true,
      })),
    ])
  );
}

export function customModelsDirty(
  config: CustomProviderConfig,
  models: CustomModelProviderModelFormValue[],
): boolean {
  return (
    JSON.stringify(requestModels(models)) !==
    JSON.stringify(
      config.models.map((model) => ({
        id: model.id,
        label: model.label,
        ...(model.contextWindow === undefined ? {} : {contextWindow: model.contextWindow}),
        ...(model.maxOutputTokens === undefined ? {} : {maxOutputTokens: model.maxOutputTokens}),
        ...(model.inputImage ? {inputImage: true} : {}),
        ...(model.reasoning ? {reasoning: true} : {}),
      })),
    )
  );
}

export function buildDiscoverModelsBody(
  values: CustomModelProviderFormValues,
): DiscoverProviderModelsCommand {
  return {
    api: values.api,
    baseUrl: values.base_url.trim(),
    ...(values.api_key.trim() ? {apiKey: values.api_key.trim()} : {}),
    ...(requestHeaders(values.headers).length > 0
      ? {
          headers: requestHeaders(values.headers).map(({name, value}) => ({
            name,
            value,
            secret: false,
          })),
        }
      : {}),
  };
}

export function buildDiscoverModelsBySlugBody(
  config: CustomProviderConfig,
  values: CustomModelProviderFormValues,
): DiscoverProviderModelsCommand {
  const body: DiscoverProviderModelsCommand = {};
  if (values.api !== config.api) body.api = values.api;
  if (values.base_url.trim() !== config.baseUrl) body.baseUrl = values.base_url.trim();
  if (values.api_key.trim()) body.apiKey = values.api_key.trim();
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

function updateHeaders(
  headers: CustomModelProviderHeaderFormValue[],
): NonNullable<UpdateCustomProviderCommand['headers']> {
  const result: NonNullable<UpdateCustomProviderCommand['headers']> = [];
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

function requestHeaders(
  headers: CustomModelProviderHeaderFormValue[],
): NonNullable<CreateCustomProviderCommand['headers']> {
  return updateHeaders(headers).flatMap((header) =>
    'value' in header && header.value
      ? [{name: header.name, value: header.value, secret: header.secret}]
      : [],
  );
}

function requestModels(
  models: CustomModelProviderModelFormValue[],
): CreateCustomProviderCommand['models'] {
  return models.flatMap((model) => {
    const id = model.id.trim();
    const label = model.label.trim();
    if (!id || !label) return [];
    return [
      {
        id,
        label,
        ...(model.context_window.trim() ? {contextWindow: Number(model.context_window)} : {}),
        ...(model.max_output_tokens.trim()
          ? {maxOutputTokens: Number(model.max_output_tokens)}
          : {}),
        ...(model.input_image ? {inputImage: true} : {}),
        ...(model.reasoning ? {reasoning: true} : {}),
      },
    ];
  });
}

function modelFormValue(model: AgentModel): CustomModelProviderModelFormValue {
  return {
    client_id: createFormRowId(),
    id: model.id,
    label: model.label,
    context_window: model.contextWindow?.toString() ?? '',
    max_output_tokens: model.maxOutputTokens?.toString() ?? '',
    input_image: model.inputImage ?? false,
    reasoning: model.reasoning ?? false,
  };
}

function normalizeHeaderName(name: string): string {
  return name.trim().toLowerCase();
}
