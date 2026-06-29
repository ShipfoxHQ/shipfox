export function normalizeNeeds(value: string | readonly string[] | undefined): readonly string[] {
  return uniqueStrings(normalizeStringArray(value));
}

function normalizeStringArray(value: string | readonly string[] | undefined): readonly string[] {
  if (value === undefined) return [];
  return typeof value === 'string' ? [value] : value;
}

function uniqueStrings(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}
