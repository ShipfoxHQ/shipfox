export const CLAAP_SETUP_URL = 'https://www.shipfox.io/docs/integrations/claap/setup';

export function apiKeyFieldError(value: string): string | undefined {
  return value.trim().length > 0 ? undefined : 'API key is required.';
}
