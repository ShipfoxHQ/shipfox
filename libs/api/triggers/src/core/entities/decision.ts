import type {TriggerDecisionDiagnostic} from './diagnostic.js';
import type {JobListenerMatcherKind} from './job-listener-subscription.js';

export const triggerDecisionOutcomes = [
  'triggered',
  'filtered',
  'filter-error',
  'dispatch-error',
  'rejected',
  // Agent routing: which conversation took a request, or that none did. `ambiguous` is a rule
  // that matched a request another agent took.
  'owner',
  'default',
  'dropped',
  'ambiguous',
] as const;
export type TriggerDecisionOutcome = (typeof triggerDecisionOutcomes)[number];
export type TriggerDecisionSubscriptionKind = 'trigger' | 'listener' | 'dev' | 'agent';

export interface TriggerDecision {
  id: string;
  receivedEventId: string;
  subscriptionKind: TriggerDecisionSubscriptionKind;
  /**
   * Null for `dev` decisions, which have no subscription row. An `agent` decision names the agent
   * subscription of a matched rule, or is null for a routing result that no rule decided.
   */
  subscriptionId: string | null;
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
  diagnostic?: TriggerDecisionDiagnostic | null;
  createdAt: Date;
}
