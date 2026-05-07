import {z} from 'zod';
import {workspaceResponseSchema} from './workspace.js';

export const e2eCreateWorkspaceBodySchema = z.object({
  user_id: z.string().uuid(),
  name: z.string().min(1).max(255),
});

export type E2eCreateWorkspaceBodyDto = z.infer<typeof e2eCreateWorkspaceBodySchema>;

export const e2eCreateWorkspaceResponseSchema = workspaceResponseSchema;

export type E2eCreateWorkspaceResponseDto = z.infer<typeof e2eCreateWorkspaceResponseSchema>;
