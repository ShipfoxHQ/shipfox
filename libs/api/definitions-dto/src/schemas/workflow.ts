import {z} from 'zod';
import {jobSchema} from './job.js';
import {triggerSchema} from './trigger.js';

/**
 * A workflow may declare at most one `source: manual` trigger. The product
 * exposes "Run" as a single affordance per workflow; multiple manual
 * triggers would force the UI to disambiguate and have no behavioural
 * upside today. The invariant is enforced at parse time so the projection
 * never needs to handle the ambiguous case.
 */
export const workflowSpecSchema = z
  .object({
    name: z.string().min(1),
    triggers: z.record(z.string(), triggerSchema).optional(),
    runner: z.union([z.string(), z.array(z.string())]).optional(),
    jobs: z.record(z.string(), jobSchema),
  })
  .superRefine((value, ctx) => {
    if (!value.triggers) return;
    const manualNames = Object.entries(value.triggers)
      .filter(([, trigger]) => trigger.source === 'manual')
      .map(([name]) => name);
    if (manualNames.length > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `a workflow may declare at most one manual trigger; found ${manualNames.length}: ${manualNames.join(', ')}`,
        path: ['triggers'],
      });
    }
  });

export type WorkflowSpecDto = z.infer<typeof workflowSpecSchema>;
