import {z} from 'zod';

export const workspaceStatusSchema = z.enum(['active', 'suspended', 'deleted']);

// A single-line display name, not free-form text. Control characters (newlines,
// tabs, etc.) are rejected because the name flows into many output contexts
// (emails, logs, the UI) where an embedded control character can corrupt
// formatting or be used to inject content. Email is one such sink: a raw newline
// there can fold the subject line or add extra lines to the plain-text body.
export const displayNameSchema = z
  .string()
  .min(1)
  .max(255)
  .regex(/^\P{Cc}+$/u, 'must not contain control characters');

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
