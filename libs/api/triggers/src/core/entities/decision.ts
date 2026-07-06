import type {JobListenerMatcherKind} from './job-listener-subscription.js';

export const triggerDecisionOutcomes = ['triggered', 'filter-error', 'dispatch-error'] as const;
export type TriggerDecisionOutcome = (typeof triggerDecisionOutcomes)[number];
export type TriggerDecisionSubscriptionKind = 'trigger' | 'listener';

export interface TriggerDecision {
  id: string;
  receivedEventId: string;
  subscriptionKind: TriggerDecisionSubscriptionKind;
  subscriptionId: string;
  subscriptionName: string;
  workflowDefinitionId: string | null;
  projectId: string | null;
  workflowRunId: string | null;
  jobId: string | null;
  matcherKind: JobListenerMatcherKind | null;
  matcherOrdinal: number | null;
  decision: TriggerDecisionOutcome;
  runId: string | null;
  runName: string | null;
  reason: string | null;
  createdAt: Date;
}
