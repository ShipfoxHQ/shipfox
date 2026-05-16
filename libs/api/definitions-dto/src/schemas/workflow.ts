import {z} from 'zod';
import {jobSchema} from './job.js';
import {triggerSchema} from './trigger.js';

// At most one manual trigger: the UI renders a single Run affordance per
// workflow and `getManualSubscriptionByDefinitionId` relies on uniqueness.
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
