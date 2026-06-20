export const triggerDecisionOutcomes = ['triggered', 'errored'] as const;
export type TriggerDecisionOutcome = (typeof triggerDecisionOutcomes)[number];

export interface TriggerDecision {
  id: string;
  receivedEventId: string;
  subscriptionId: string;
  definitionId: string;
  projectId: string;
  decision: TriggerDecisionOutcome;
  runId: string | null;
  runName: string | null;
  reason: string | null;
  createdAt: Date;
}
