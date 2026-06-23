import {triggerEventOutcomeSchema} from '@shipfox/api-triggers-dto';
import {z} from 'zod';

/**
 * URL search params for the Events page. Reuses the DTO outcome enum so the page and the
 * read API share one source of truth, and matches the `TriggerEventFilters` shape the data
 * hook consumes. Every field uses `.catch(undefined)` so a hand-edited or stale URL drops
 * the bad param rather than throwing inside the router's `validateSearch`.
 */
export const triggerEventsSearchSchema = z.object({
  source: z.string().optional().catch(undefined),
  event: z.string().optional().catch(undefined),
  outcome: z.array(triggerEventOutcomeSchema).optional().catch(undefined),
  from: z.string().optional().catch(undefined),
  to: z.string().optional().catch(undefined),
});

export type TriggerEventsSearch = z.infer<typeof triggerEventsSearchSchema>;

export function validateTriggerEventsSearch(search: Record<string, unknown>): TriggerEventsSearch {
  return triggerEventsSearchSchema.parse(search);
}
