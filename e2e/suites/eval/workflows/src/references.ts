export interface PullRequestReference {
  number: number;
  head: string;
  base: string;
  sha: string;
  repository: string;
}

export interface ScenarioReferences {
  /** Read on first use, so a scenario that never names `$pr` doesn't need a pull request. */
  pr: () => PullRequestReference;
}

const FIELDS = ['number', 'head', 'base', 'sha', 'repository', 'url'] as const;
type ReferenceField = (typeof FIELDS)[number];
const WHOLE_REFERENCE = /^\$pr(?:\.(number|head|base|sha|repository|url))?$/u;
const EMBEDDED_REFERENCE = /\$pr\.(number|head|base|sha|repository|url)\b/gu;

// The GitHub fake serves every pull request at this address.
function fieldOf(pr: PullRequestReference, field: ReferenceField): string | number {
  return field === 'url' ? `https://github.com/${pr.repository}/pull/${pr.number}` : pr[field];
}

/**
 * Replaces `$pr` and `$pr.<field>` strings anywhere in a scenario value. A string that is only a
 * reference becomes the value itself. A reference inside longer text becomes its text, as in
 * `Opened pull request: $pr.url`. `url` is the pull request's address.
 */
export function resolveReferences(value: unknown, references: ScenarioReferences): unknown {
  if (typeof value === 'string') {
    const whole = WHOLE_REFERENCE.exec(value);
    if (whole) {
      const pr = references.pr();
      return whole[1] === undefined ? pr : fieldOf(pr, whole[1] as ReferenceField);
    }
    return value.replace(EMBEDDED_REFERENCE, (_match, field: ReferenceField) =>
      String(fieldOf(references.pr(), field)),
    );
  }
  if (Array.isArray(value)) return value.map((item) => resolveReferences(item, references));
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, resolveReferences(item, references)]),
    );
  }
  return value;
}
