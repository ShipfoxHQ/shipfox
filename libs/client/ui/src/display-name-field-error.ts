import {DISPLAY_NAME_DISALLOWED_CHARACTER_RE} from '@shipfox/regex';

interface DisplayNameSchema {
  safeParse: (value: string) => {success: boolean};
}

export function displayNameFieldError(
  value: string,
  label: string,
  schema: DisplayNameSchema,
): string | undefined {
  if (schema.safeParse(value).success) return undefined;
  if (DISPLAY_NAME_DISALLOWED_CHARACTER_RE.test(value)) {
    return `${label} cannot include line breaks, tabs, or hidden formatting characters.`;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) return `${label} is required.`;
  if (trimmed.length > 255) return `${label} must be 255 characters or fewer.`;
  return `${label} is invalid.`;
}
