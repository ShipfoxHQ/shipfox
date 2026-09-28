import {z} from 'zod';

export const workflowTemplateGroupSchema = z.enum([
  'try_now',
  'starts_on_event',
  'needs_connection',
]);
export type WorkflowTemplateGroupDto = z.infer<typeof workflowTemplateGroupSchema>;

export const workspaceWorkflowTemplateSchema = z.object({
  id: z.string(),
  title: z.string(),
  summary: z.string(),
  group: workflowTemplateGroupSchema,
  start_label: z
    .string()
    .nullable()
    .describe("The workflow's starting phrase, or null when every role binding starts manually."),
  providers: z.array(z.string()),
  missing_providers: z.array(z.string()),
  prompt: z.string(),
});
export type WorkspaceWorkflowTemplateDto = z.infer<typeof workspaceWorkflowTemplateSchema>;

export const listWorkspaceWorkflowTemplatesResponseSchema = z.object({
  templates: z.array(workspaceWorkflowTemplateSchema),
});
export type ListWorkspaceWorkflowTemplatesResponseDto = z.infer<
  typeof listWorkspaceWorkflowTemplatesResponseSchema
>;
