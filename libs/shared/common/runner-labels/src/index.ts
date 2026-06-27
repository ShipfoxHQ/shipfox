export const RUNNER_LABEL_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;
export const MAX_RUNNER_LABEL_LENGTH = 64;
export const MAX_RUNNER_LABELS = 20;

export function canonicalizeLabels(
  value: string | readonly string[] | undefined,
): readonly string[] {
  const labels = value === undefined ? [] : typeof value === 'string' ? [value] : value;
  const normalized = labels.map((label) => label.trim().toLowerCase()).filter(Boolean);

  return [...new Set(normalized)].sort();
}

export function parseLabelList(value: string): readonly string[] {
  return canonicalizeLabels(value.split(','));
}

export function findInvalidLabels(labels: readonly string[]): readonly string[] {
  return labels.filter(
    (label) => label.length > MAX_RUNNER_LABEL_LENGTH || !RUNNER_LABEL_PATTERN.test(label),
  );
}
