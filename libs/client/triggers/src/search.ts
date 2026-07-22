import {z} from 'zod';
import {type TriggerEventFilters, triggerEventOutcomes} from '#core/trigger-event.js';

const stringListSearchSchema = z
  .preprocess((value) => (typeof value === 'string' ? [value] : value), z.array(z.string()))
  .optional()
  .catch(undefined);

const outcomeListSearchSchema = z
  .preprocess(
    (value) => (typeof value === 'string' ? [value] : value),
    z.array(z.enum(triggerEventOutcomes)),
  )
  .optional()
  .catch(undefined);

/**
 * URL search params for the Events page. Matches the `TriggerEventFilters` shape the data
 * hook consumes. Every field uses `.catch(undefined)` so a hand-edited or stale URL drops
 * the bad param rather than throwing inside the router's `validateSearch`.
 */
export const triggerEventsSearchSchema = z.object({
  source: stringListSearchSchema,
  event: stringListSearchSchema,
  outcome: outcomeListSearchSchema,
  // The read API requires ISO datetimes (`z.string().datetime()`); validate the same here so
  // a hand-edited or stale URL with a non-ISO date drops the param rather than forwarding it
  // and turning the first fetch into a full-page load error.
  from: z.string().datetime().optional().catch(undefined),
  to: z.string().datetime().optional().catch(undefined),
});

export type TriggerEventsSearch = z.infer<typeof triggerEventsSearchSchema> & TriggerEventFilters;

export function validateTriggerEventsSearch(search: Record<string, unknown>): TriggerEventsSearch {
  return triggerEventsSearchSchema.parse(search);
}
