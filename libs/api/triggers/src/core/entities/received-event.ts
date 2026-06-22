export const triggerEventOrigins = ['integration', 'manual'] as const;
export type TriggerEventOrigin = (typeof triggerEventOrigins)[number];

export const triggerEventOutcomes = ['received', 'routed', 'discarded', 'failed'] as const;
export type TriggerEventOutcome = (typeof triggerEventOutcomes)[number];

export interface TriggerReceivedEvent {
  id: string;
  eventRef: string;
  origin: TriggerEventOrigin;
  workspaceId: string;
  source: string;
  event: string;
  deliveryId: string | null;
  connectionId: string | null;
  outcome: TriggerEventOutcome;
  matchedCount: number;
  payload: Record<string, unknown> | null;
  receivedAt: Date;
  processedAt: Date | null;
  createdAt: Date;
}

/**
 * Trigger event shape for list read models.
 * It omits payload because webhook bodies can be large/untrusted and only detail views render them.
 */
export type TriggerReceivedEventSummary = Omit<TriggerReceivedEvent, 'payload'>;
