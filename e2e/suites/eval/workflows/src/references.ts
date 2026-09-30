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

const REFERENCE = /^\$pr(?:\.(number|head|base|sha|repository))?$/u;

/** Replaces `$pr` and `$pr.<field>` strings anywhere in a scenario value. */
export function resolveReferences(value: unknown, references: ScenarioReferences): unknown {
  if (typeof value === 'string') {
    const match = REFERENCE.exec(value);
    if (!match) return value;
    const pr = references.pr();
    return match[1] === undefined ? pr : pr[match[1] as keyof PullRequestReference];
  }
  if (Array.isArray(value)) return value.map((item) => resolveReferences(item, references));
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, resolveReferences(item, references)]),
    );
  }
  return value;
}
