import type {
  CreateCustomModelProviderBodyDto,
  DiscoverCustomModelProviderModelsBodyDto,
  DiscoverCustomModelProviderModelsBySlugBodyDto,
  SetDefaultHarnessBodyDto,
  SetDefaultModelProviderBodyDto,
  UpdateCustomModelProviderBodyDto,
  UpdateModelProviderConfigBodyDto,
  UpdateModelProviderDefaultModelBodyDto,
} from '@shipfox/api-agent-dto';
import type {
  CreateCustomProviderCommand,
  CustomProviderHeaderCommand,
  CustomProviderModelCommand,
  DiscoverProviderModelsCommand,
  ProviderCredentialsCommand,
  UpdateCustomProviderCommand,
} from '#core/models.js';

export function toProviderCredentialsBody(
  command: ProviderCredentialsCommand,
): UpdateModelProviderConfigBodyDto {
  return {
    ...(command.defaultModel === undefined ? {} : {default_model: command.defaultModel}),
    credentials: command.credentials,
    ...(command.setAsDefault ? {set_as_default: true} : {}),
  };
}

export function toDefaultModelBody(
  defaultModel: string | null,
): UpdateModelProviderDefaultModelBodyDto {
  return {default_model: defaultModel};
}

export function toDefaultProviderBody(providerId: string): SetDefaultModelProviderBodyDto {
  return {provider_id: providerId};
}

export function toDefaultHarnessBody(harnessId: 'pi' | 'claude'): SetDefaultHarnessBodyDto {
  return {harness_id: harnessId};
}

export function toCreateCustomProviderBody(
  command: CreateCustomProviderCommand,
): CreateCustomModelProviderBodyDto {
  return {
    slug: command.slug,
    display_name: command.displayName,
    api: command.api,
    base_url: command.baseUrl,
    ...(command.apiKey ? {api_key: command.apiKey} : {}),
    ...(command.headers?.length ? {headers: command.headers.map(toCreateHeader)} : {}),
    models: command.models.map(toModel),
    ...(command.defaultModel ? {default_model: command.defaultModel} : {}),
  };
}

export function toUpdateCustomProviderBody(
  command: UpdateCustomProviderCommand,
): UpdateCustomModelProviderBodyDto {
  return {
    ...(command.displayName === undefined ? {} : {display_name: command.displayName}),
    ...(command.api === undefined ? {} : {api: command.api}),
    ...(command.baseUrl === undefined ? {} : {base_url: command.baseUrl}),
    ...(command.apiKey === undefined ? {} : {api_key: command.apiKey}),
    ...(command.headers === undefined ? {} : {headers: command.headers.map(toUpdateHeader)}),
    ...(command.models === undefined ? {} : {models: command.models.map(toModel)}),
    ...(command.defaultModel === undefined ? {} : {default_model: command.defaultModel}),
  };
}

export function toDiscoverModelsBody(
  command: DiscoverProviderModelsCommand,
): DiscoverCustomModelProviderModelsBodyDto {
  if (command.api === undefined || command.baseUrl === undefined) {
    throw new Error('Model discovery requires an API and base URL.');
  }
  return {
    api: command.api,
    base_url: command.baseUrl,
    ...(command.apiKey ? {api_key: command.apiKey} : {}),
    ...(command.headers?.length
      ? {headers: command.headers.flatMap(({name, value}) => (value ? [{name, value}] : []))}
      : {}),
  };
}

export function toDiscoverModelsBySlugBody(
  command: DiscoverProviderModelsCommand,
): DiscoverCustomModelProviderModelsBySlugBodyDto {
  return {
    ...(command.api === undefined ? {} : {api: command.api}),
    ...(command.baseUrl === undefined ? {} : {base_url: command.baseUrl}),
    ...(command.apiKey === undefined ? {} : {api_key: command.apiKey}),
    ...(command.headers === undefined ? {} : {headers: command.headers.map(toUpdateHeader)}),
  };
}

function toCreateHeader(header: CustomProviderHeaderCommand) {
  return {name: header.name, value: header.value ?? '', secret: header.secret};
}

function toUpdateHeader(header: CustomProviderHeaderCommand) {
  return {
    name: header.name,
    ...(header.value === undefined ? {} : {value: header.value}),
    secret: header.secret,
    ...(header.keep ? {keep: true} : {}),
  };
}

function toModel(model: CustomProviderModelCommand) {
  return {
    id: model.id,
    label: model.label,
    ...(model.contextWindow === undefined ? {} : {context_window: model.contextWindow}),
    ...(model.maxOutputTokens === undefined ? {} : {max_output_tokens: model.maxOutputTokens}),
    ...(model.inputImage ? {input_image: true} : {}),
    ...(model.reasoning ? {reasoning: true} : {}),
  };
}
