import type {WorkflowModelConcurrency} from '@shipfox/api-definitions-dto';

export const WORKFLOW_CONCURRENCY_GROUP_MAX_BYTES = 256;

export type WorkflowConcurrencyScope = WorkflowModelConcurrency['scope'];

export interface ResolvedWorkflowConcurrency {
  readonly group: string;
  readonly scope: WorkflowConcurrencyScope;
  readonly cancelInProgress: boolean;
}

export interface CanonicalWorkflowConcurrencyGroup {
  readonly displayGroup: string;
  readonly canonicalGroupKey: string;
}

export interface WorkflowConcurrencyIdentity {
  readonly projectId: string;
  readonly originScope: string;
  readonly scope: WorkflowConcurrencyScope;
  readonly definitionId: string | null;
  readonly canonicalGroupKey: string;
}

export class InvalidWorkflowConcurrencyGroupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidWorkflowConcurrencyGroupError';
  }
}

/**
 * Trims and case-folds a resolved group without normalizing its Unicode representation.
 * The byte limit applies only to the display value, as required by the concurrency contract.
 */
export function canonicalizeWorkflowConcurrencyGroup(
  group: string,
): CanonicalWorkflowConcurrencyGroup {
  const displayGroup = group.trim();
  const displayBytes = Buffer.byteLength(displayGroup, 'utf8');
  if (displayBytes === 0 || displayBytes > WORKFLOW_CONCURRENCY_GROUP_MAX_BYTES) {
    throw new InvalidWorkflowConcurrencyGroupError(
      `Concurrency group must contain between 1 and ${WORKFLOW_CONCURRENCY_GROUP_MAX_BYTES} UTF-8 bytes after trimming.`,
    );
  }

  return {displayGroup, canonicalGroupKey: unicodeCaseFold(displayGroup)};
}

export function workflowConcurrencyOriginScope(params: {
  readonly origin: 'synced' | 'dev';
  readonly initiatedByUserId?: string | null | undefined;
}): string {
  if (params.origin === 'synced') return 'synced';
  if (!params.initiatedByUserId) {
    throw new Error('A dev workflow concurrency claim requires its initiating user.');
  }
  return `dev:${params.initiatedByUserId}`;
}

export function workflowConcurrencyIdentity(params: {
  readonly projectId: string;
  readonly definitionId: string;
  readonly originScope: string;
  readonly concurrency: CanonicalWorkflowConcurrencyGroup & {
    readonly scope: WorkflowConcurrencyScope;
  };
}): WorkflowConcurrencyIdentity {
  return {
    projectId: params.projectId,
    originScope: params.originScope,
    scope: params.concurrency.scope,
    definitionId: params.concurrency.scope === 'workflow' ? params.definitionId : null,
    canonicalGroupKey: params.concurrency.canonicalGroupKey,
  };
}

/**
 * Uses a structured key so delimiter characters in IDs or group values cannot alias identities.
 * PostgreSQL hashes this key for the advisory lock; the database identity remains explicit.
 */
export function workflowConcurrencyIdentityKey(identity: WorkflowConcurrencyIdentity): string {
  return JSON.stringify([
    identity.projectId,
    identity.originScope,
    identity.scope,
    identity.definitionId,
    identity.canonicalGroupKey,
  ]);
}

export type WorkflowConcurrencyAdmissionState = 'acquired' | 'waiting';

export function nextWorkflowConcurrencyAdmission(params: {
  readonly hasAcquiredClaim: boolean;
  readonly hasWaitingClaim: boolean;
}): {
  readonly state: WorkflowConcurrencyAdmissionState;
  readonly supersedesWaiter: boolean;
} {
  if (!params.hasAcquiredClaim) {
    return {state: 'acquired', supersedesWaiter: params.hasWaitingClaim};
  }
  return {state: 'waiting', supersedesWaiter: params.hasWaitingClaim};
}

// JavaScript's locale-independent lowercase operation implements most of the Unicode
// case-folding table. These entries are the non-lowercase-compatible full-fold mappings.
const FULL_CASE_FOLD_OVERRIDES: Readonly<Record<string, string>> = {
  '\u00b5': '\u03bc',
  '\u00df': 'ss',
  '\u0149': '\u02bcn',
  '\u017f': 's',
  '\u01f0': 'j\u030c',
  '\u0345': '\u03b9',
  '\u0390': '\u03b9\u0308\u0301',
  '\u03b0': '\u03c5\u0308\u0301',
  '\u03c2': '\u03c3',
  '\u03d0': '\u03b2',
  '\u03d1': '\u03b8',
  '\u03d5': '\u03c6',
  '\u03d6': '\u03c0',
  '\u03f0': '\u03ba',
  '\u03f1': '\u03c1',
  '\u03f5': '\u03b5',
  '\u0587': '\u0565\u0582',
  '\u1e9e': 'ss',
  '\ufb00': 'ff',
  '\ufb01': 'fi',
  '\ufb02': 'fl',
  '\ufb03': 'ffi',
  '\ufb04': 'ffl',
  '\ufb05': 'st',
  '\ufb06': 'st',
  '\ufb13': '\u0574\u0576',
  '\ufb14': '\u0574\u0565',
  '\ufb15': '\u0574\u056b',
  '\ufb16': '\u057e\u0576',
  '\ufb17': '\u0574\u056d',
};

function unicodeCaseFold(value: string): string {
  return [...value.toLowerCase()]
    .map((character) => FULL_CASE_FOLD_OVERRIDES[character] ?? character)
    .join('');
}
