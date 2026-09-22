import {z} from 'zod';

export const WORKFLOW_SCHEMA_DOCUMENT_FILE = 'content/generated/reference/workflow-schema.json';

const fieldNodeSchema = z.object({
  name: z.string(),
  type: z.string(),
  requirement: z.enum(['required', 'optional']),
  description: z.string(),
  enum: z.array(z.string()).optional(),
  default: z.string().optional(),
  constraints: z.string().optional(),
  link: z.string().optional(),
});

const exampleSchema = z.object({
  file: z.string(),
  code: z.string(),
});

const sectionSchema = z.object({
  id: z.string(),
  component: z.string(),
  path: z.string(),
  kind: z.enum(['run', 'agent', 'tool', 'checkout']).optional(),
  fields: z.array(fieldNodeSchema),
  example: exampleSchema,
  markdown: z.string(),
});

export const workflowSchemaDocumentSchema = z.object({sections: z.array(sectionSchema)});

export type FieldNode = z.infer<typeof fieldNodeSchema>;
export type WorkflowSchemaExample = z.infer<typeof exampleSchema>;
export type WorkflowSchemaSection = z.infer<typeof sectionSchema>;
export type WorkflowSchemaDocument = z.infer<typeof workflowSchemaDocumentSchema>;
