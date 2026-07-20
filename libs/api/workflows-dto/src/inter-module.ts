import {defineInterModuleContract, type InterModuleClient} from '@shipfox/inter-module';
import {z} from 'zod';

const idSchema = z.string().uuid();
const triggerPayloadSchema = z.union([
  z.object({
    provider: z.literal('manual').optional(),
    source: z.literal('manual'),
    event: z.literal('fire'),
    subscriptionId: idSchema,
    userId: idSchema,
  }),
  z.object({
    provider: z.literal('cron').optional(),
    source: z.literal('cron'),
    event: z.literal('tick'),
    scheduleId: idSchema,
  }),
  z.object({
    provider: z.string(),
    source: z.string(),
    event: z.string(),
    deliveryId: z.string(),
    data: z.unknown(),
  }),
]);

const interpolationFieldSchema = z.enum([
  'run',
  'env',
  'agent.prompt',
  'agent.model',
  'agent.provider',
  'job.runner',
  'job.outputs',
  'job.name',
  'step.name',
  'step.feedback',
]);

/**
 * Producer-owned Workflows commands used by synchronous callers. Commands carry
 * stable identities whenever a retry could create a duplicate run.
 */
export const workflowsInterModuleContract = defineInterModuleContract({
  module: 'workflows',
  methods: {
    startRunFromTrigger: {
      input: z.object({
        workspaceId: idSchema,
        projectId: idSchema,
        definitionId: idSchema,
        triggerPayload: triggerPayloadSchema,
        inputs: z.record(z.string(), z.unknown()).optional(),
        idempotencyKey: z.string().min(1),
      }),
      output: z.object({id: idSchema, name: z.string()}),
      errors: {
        'definition-not-found': z.object({definitionId: idSchema}),
        'project-mismatch': z.object({}),
        'agent-config-unresolvable': z.object({definitionId: idSchema}),
        'agent-integration-materialization-failed': z.object({}),
        'interpolation-unresolvable': z.object({
          definitionId: idSchema,
          field: interpolationFieldSchema,
          source: z.string(),
          envKey: z.string().optional(),
        }),
        'invalid-job-runner-labels': z.object({labels: z.array(z.string())}),
      },
    },
    deliverEventToJobListener: {
      input: z.object({
        jobId: idSchema,
        disposition: z.enum(['fire', 'resolve']),
        eventRef: z.string().min(1),
        deliveryId: z.string().min(1),
        source: z.string().min(1),
        event: z.string().min(1),
        provider: z.string().min(1),
        payload: z.unknown(),
        receivedAt: z.string().datetime(),
      }),
      output: z.object({buffered: z.boolean(), skipped: z.boolean()}),
    },
  },
});

export type WorkflowsModuleClient = InterModuleClient<typeof workflowsInterModuleContract>;
