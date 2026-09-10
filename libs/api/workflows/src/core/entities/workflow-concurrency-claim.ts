import type {WorkflowConcurrencyScope} from '#core/workflow-concurrency.js';

export type WorkflowConcurrencyClaimState = 'acquired' | 'waiting' | 'superseded' | 'released';

export interface WorkflowConcurrencyClaim {
  readonly id: string;
  readonly projectId: string;
  readonly originScope: string;
  readonly scope: WorkflowConcurrencyScope;
  readonly definitionId: string | null;
  readonly displayGroup: string;
  readonly canonicalGroupKey: string;
  readonly workflowRunId: string;
  readonly workflowRunAttemptId: string;
  readonly generation: number;
  readonly cancelInProgress: boolean;
  readonly state: WorkflowConcurrencyClaimState;
  readonly supersededByClaimId: string | null;
  readonly cancellationRequestedAt: Date | null;
  readonly stateChangedAt: Date;
  readonly acquiredAt: Date | null;
  readonly waitingAt: Date | null;
  readonly supersededAt: Date | null;
  readonly releasedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export function transitionWorkflowConcurrencyClaim(
  state: WorkflowConcurrencyClaimState,
  transition: 'promote' | 'release' | 'supersede',
): WorkflowConcurrencyClaimState {
  if (transition === 'release' && (state === 'acquired' || state === 'waiting')) {
    return 'released';
  }
  if (transition === 'supersede' && state === 'waiting') return 'superseded';
  if (transition === 'promote' && state === 'waiting') return 'acquired';
  throw new Error(`Cannot ${transition} a ${state} concurrency claim.`);
}

export function isLiveWorkflowConcurrencyClaim(
  state: WorkflowConcurrencyClaimState,
): state is Extract<WorkflowConcurrencyClaimState, 'acquired' | 'waiting'> {
  return state === 'acquired' || state === 'waiting';
}
