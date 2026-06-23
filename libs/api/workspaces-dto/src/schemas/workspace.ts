import {displayNameSchema} from '@shipfox/api-common-dto';
import {z} from 'zod';

export const workspaceStatusSchema = z.enum(['active', 'suspended', 'deleted']);

export const createWorkspaceBodySchema = z.object({
  name: displayNameSchema,
});

export type CreateWorkspaceBodyDto = z.infer<typeof createWorkspaceBodySchema>;

export const workspaceDtoSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  status: workspaceStatusSchema,
  settings: z.record(z.string(), z.unknown()),
  created_at: z.string(),
  updated_at: z.string(),
});

export type WorkspaceDto = z.infer<typeof workspaceDtoSchema>;

export const workspaceResponseSchema = workspaceDtoSchema;

export type WorkspaceResponseDto = z.infer<typeof workspaceResponseSchema>;
