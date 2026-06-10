import {z} from 'zod';

export const projectParamsSchema = z.object({
  projectId: z.string().uuid(),
});

export const projectWorkflowParamsSchema = projectParamsSchema.extend({
  workflowId: z.string().min(1),
});

export const projectRunParamsSchema = projectParamsSchema.extend({
  runId: z.string().min(1),
});
