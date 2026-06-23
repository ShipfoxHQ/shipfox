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
  // The read API requires ISO datetimes (`z.string().datetime()`); validate the same here so
  // a hand-edited or stale URL with a non-ISO date drops the param rather than forwarding it
  // and turning the first fetch into a full-page load error.
  from: z.string().datetime().optional().catch(undefined),
  to: z.string().datetime().optional().catch(undefined),
});

export type TriggerEventsSearch = z.infer<typeof triggerEventsSearchSchema>;

export function validateTriggerEventsSearch(search: Record<string, unknown>): TriggerEventsSearch {
  return triggerEventsSearchSchema.parse(search);
}
