import {z} from 'zod';
import {runListResponseSchema} from './run.js';
import {runDetailResponseSchema} from './run-detail.js';

export const e2eCreateWorkflowRunPageFixtureBodySchema = z.object({
  workspace_id: z.string().uuid(),
  project_name: z.string().min(1).max(120).optional(),
});

export type E2eCreateWorkflowRunPageFixtureBodyDto = z.infer<
  typeof e2eCreateWorkflowRunPageFixtureBodySchema
>;

export const e2eWorkflowRunPageFixtureResponseSchema = z.object({
  project: z.object({
    id: z.string().uuid(),
    workspace_id: z.string().uuid(),
    name: z.string(),
  }),
  run_list: runListResponseSchema,
  runs: z.object({
    succeeded: runDetailResponseSchema,
    failed: runDetailResponseSchema,
    running: runDetailResponseSchema,
  }),
  deferred: z.object({
    gated_restart: z.literal('typed-gate-restart-contract-not-on-main'),
  }),
});

export type E2eWorkflowRunPageFixtureResponseDto = z.infer<
  typeof e2eWorkflowRunPageFixtureResponseSchema
>;
