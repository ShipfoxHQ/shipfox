import {MODEL_PROVIDER_SLUG_PATTERN} from '@shipfox/api-agent-dto';

const MAX_SLUG_LENGTH = 40;
const SLUG_FORMAT_ERROR =
  'Use 3-40 lowercase letters, digits, and dashes; start and end with a letter or digit.';

export function deriveCustomModelProviderSlug(displayName: string): string {
  return displayName
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, '');
}

export function customModelProviderSlugError(
  slug: string,
  reservedProviderIds: readonly string[] = [],
): string | undefined {
  const trimmed = slug.trim();
  if (!MODEL_PROVIDER_SLUG_PATTERN.test(trimmed)) return SLUG_FORMAT_ERROR;
  if (reservedProviderIds.includes(trimmed)) return 'This id is reserved for a built-in provider.';
  return undefined;
}
