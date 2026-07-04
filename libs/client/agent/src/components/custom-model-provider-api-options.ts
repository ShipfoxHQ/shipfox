import type {ModelProviderApi} from '@shipfox/api-agent-dto';

export const MODEL_PROVIDER_API_OPTIONS: Array<{value: ModelProviderApi; label: string}> = [
  {value: 'openai-completions', label: 'OpenAI Chat Completions'},
  {value: 'openai-responses', label: 'OpenAI Responses'},
  {value: 'anthropic-messages', label: 'Anthropic Messages'},
  {value: 'google-generative-ai', label: 'Google Generative AI'},
];

export function modelProviderApiLabel(api: ModelProviderApi): string {
  return MODEL_PROVIDER_API_OPTIONS.find((option) => option.value === api)?.label ?? api;
}
