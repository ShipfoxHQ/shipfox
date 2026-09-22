import {z} from 'zod';

const identifierSchema = z
  .string()
  .min(1)
  .regex(/^[a-z0-9][a-z0-9_-]*$/);
const environmentNameSchema = z
  .string()
  .min(1)
  .regex(/^[A-Za-z][A-Za-z0-9_-]*$/);

export const workflowTemplateRoleSchema = z.object({
  providers: z.array(identifierSchema).min(1),
  from: z.literal('project').optional(),
});

export const workflowTemplateOptionChoiceSchema = z.object({
  id: identifierSchema,
  label: z.string().min(1).optional(),
  default: z.boolean().optional(),
  tradeoff: z.string().min(1).optional(),
});

export const workflowTemplateOptionSchema = z
  .object({
    id: identifierSchema,
    question: z.string().min(1).optional(),
    choices: z.array(workflowTemplateOptionChoiceSchema).min(1),
    tradeoff: z.string().min(1).optional(),
    tradeoffs: z.record(identifierSchema, z.string().min(1)).optional(),
    applies_to: z.array(identifierSchema).optional(),
  })
  .superRefine((option, context) => {
    const choiceIds = new Set<string>();
    let defaultCount = 0;

    option.choices.forEach((choice, index) => {
      if (choiceIds.has(choice.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['choices', index, 'id'],
          message: 'Choice ids must be unique within an option',
        });
      }
      choiceIds.add(choice.id);
      if (choice.default === true) defaultCount += 1;
    });

    if (defaultCount > 1) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['choices'],
        message: 'An option may declare at most one default choice',
      });
    }
  });

export const workflowTemplateManifestSchema = z.object({
  id: identifierSchema,
  revision: z.number().int().positive(),
  added_at: z.string().date(),
  title: z.string().min(1),
  summary: z.string().min(1),
  roles: z
    .record(identifierSchema, workflowTemplateRoleSchema)
    .refine((roles) => Object.keys(roles).length > 0, 'A template must declare at least one role'),
  options: z.array(workflowTemplateOptionSchema).default([]),
  slots: z.array(identifierSchema).default([]),
  secrets: z.array(environmentNameSchema).default([]),
  variables: z.array(environmentNameSchema).default([]),
});

export type WorkflowTemplateRole = z.infer<typeof workflowTemplateRoleSchema>;
export type WorkflowTemplateOptionChoice = z.infer<typeof workflowTemplateOptionChoiceSchema>;
export type WorkflowTemplateOption = z.infer<typeof workflowTemplateOptionSchema>;
export type WorkflowTemplateManifest = z.infer<typeof workflowTemplateManifestSchema>;

export const templateManifestSchema = workflowTemplateManifestSchema;
export const manifestSchema = workflowTemplateManifestSchema;
export const roleSchema = workflowTemplateRoleSchema;
export const optionSchema = workflowTemplateOptionSchema;
