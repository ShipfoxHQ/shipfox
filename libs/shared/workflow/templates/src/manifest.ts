import {z} from 'zod';

const identifierSchema = z
  .string()
  .min(1)
  .regex(/^[a-z0-9][a-z0-9_-]*$/);
const environmentNameSchema = z
  .string()
  .min(1)
  .regex(/^[A-Za-z][A-Za-z0-9_-]*$/);
const registrySlugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const registryPackageNameSchema = z.string().refine(
  (value) => {
    const [namespace, name, ...extraSegments] = value.split('/');
    return (
      extraSegments.length === 0 &&
      [namespace, name].every(
        (segment) =>
          segment !== undefined &&
          segment.length >= 2 &&
          segment.length <= 40 &&
          registrySlugPattern.test(segment),
      )
    );
  },
  {message: 'Expected a registry package name such as shipfox/slack-thread-digest'},
);

export const workflowTemplateRoleSchema = z
  .object({
    providers: z.array(identifierSchema).min(1),
    from: z.literal('project').optional(),
    optional: z.boolean().optional(),
    question: z.string().min(1).optional(),
    tradeoff: z.string().min(1).optional(),
  })
  .superRefine((role, context) => {
    if (role.optional !== true) {
      if (role.question !== undefined || role.tradeoff !== undefined) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Only an optional role declares a question and tradeoff',
        });
      }
      return;
    }
    if (role.from === 'project') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['optional'],
        message: 'A role set from the project cannot be optional',
      });
    }
    for (const field of ['question', 'tradeoff'] as const) {
      if (role[field] === undefined) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [field],
          message: `An optional role needs a ${field}`,
        });
      }
    }
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

export const workflowTemplateModelSchema = z
  .object({
    note: z.string().min(1).optional(),
  })
  .strict();

export const workflowTemplateWhenSchema = z.union([
  z.object({role: identifierSchema}).strict(),
  z.object({role: identifierSchema, provider: identifierSchema}).strict(),
  z.object({option: identifierSchema, choices: z.array(identifierSchema).min(1)}).strict(),
]);

export const workflowTemplateFlowStepSchema = z
  .object({
    kind: z.enum(['trigger', 'agent', 'check', 'tool', 'write', 'human']),
    provider: identifierSchema.optional(),
    title: z.string().min(1),
    detail: z.string().min(1),
    loops_to: z.number().int().nonnegative().optional(),
  })
  .strict();

export const workflowTemplateWriteSchema = z
  .object({
    provider: identifierSchema,
    action: z.string().min(1),
    when: workflowTemplateWhenSchema.optional(),
  })
  .strict();

export const workflowTemplatePrerequisiteSchema = z.union([
  z.string().min(1),
  z
    .object({
      text: z.string().min(1),
      when: workflowTemplateWhenSchema.optional(),
    })
    .strict(),
]);

export const workflowTemplateSlotSchema = z
  .object({
    id: identifierSchema,
    description: z.string().min(1),
  })
  .strict();

export const workflowTemplateSecretSchema = z
  .object({
    name: environmentNameSchema,
    description: z.string().min(1),
  })
  .strict();

export const workflowTemplateVariableSchema = z
  .object({
    name: environmentNameSchema,
    description: z.string().min(1),
  })
  .strict();

export const workflowTemplateManifestSchema = z
  .object({
    title: z.string().min(1).max(80),
    summary: z.string().min(1).max(160),
    keywords: z.array(identifierSchema).max(10).default([]),
    starts: z.string().trim().min(1).max(120),
    flow: z.array(workflowTemplateFlowStepSchema).default([]),
    writes: z.array(workflowTemplateWriteSchema).default([]),
    prerequisites: z.array(workflowTemplatePrerequisiteSchema).default([]),
    related: z.array(registryPackageNameSchema).default([]),
    roles: z
      .record(identifierSchema, workflowTemplateRoleSchema)
      .refine(
        (roles) => Object.keys(roles).length > 0,
        'A template must declare at least one role',
      ),
    options: z.array(workflowTemplateOptionSchema).default([]),
    models: z.record(identifierSchema, workflowTemplateModelSchema).default({}),
    slots: z.array(workflowTemplateSlotSchema).default([]),
    secrets: z.array(workflowTemplateSecretSchema).default([]),
    variables: z.array(workflowTemplateVariableSchema).default([]),
  })
  .strict()
  .superRefine((manifest, context) => {
    const providers = new Set([
      'shipfox',
      ...Object.values(manifest.roles).flatMap((role) => role.providers),
    ]);
    const roles = manifest.roles;
    const options = new Map(manifest.options.map((option) => [option.id, option]));
    const optionIds = new Set<string>();

    manifest.options.forEach((option, index) => {
      if (optionIds.has(option.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['options', index, 'id'],
          message: 'Option ids must be unique',
        });
      }
      optionIds.add(option.id);
    });

    manifest.keywords.forEach((keyword, index) => {
      if (manifest.keywords.indexOf(keyword) !== index) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['keywords', index],
          message: 'Keywords must be unique',
        });
      }
    });

    for (const [index, step] of manifest.flow.entries()) {
      if (step.provider !== undefined && !providers.has(step.provider)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['flow', index, 'provider'],
          message: `Unknown flow provider: ${step.provider}`,
        });
      }
      if (step.loops_to !== undefined && step.loops_to >= index) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['flow', index, 'loops_to'],
          message: 'loops_to must point to an earlier flow step',
        });
      }
    }

    for (const [index, write] of manifest.writes.entries()) {
      if (!providers.has(write.provider)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['writes', index, 'provider'],
          message: `Unknown write provider: ${write.provider}`,
        });
      }
      validateWhen(write.when, ['writes', index, 'when'], roles, options, context);
    }

    for (const [index, prerequisite] of manifest.prerequisites.entries()) {
      if (typeof prerequisite !== 'string') {
        validateWhen(prerequisite.when, ['prerequisites', index, 'when'], roles, options, context);
      }
    }
  });

function validateWhen(
  when: WorkflowTemplateWhen | undefined,
  path: (string | number)[],
  roles: WorkflowTemplateManifest['roles'],
  options: ReadonlyMap<string, WorkflowTemplateOption>,
  context: z.RefinementCtx,
): void {
  if (when === undefined) return;

  if ('role' in when) {
    if (!Object.hasOwn(roles, when.role)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [...path, 'role'],
        message: `Unknown role in when condition: ${when.role}`,
      });
      return;
    }
    const role = roles[when.role];
    if (role === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [...path, 'role'],
        message: `Unknown role in when condition: ${when.role}`,
      });
      return;
    }
    if ('provider' in when && !role.providers.includes(when.provider)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [...path, 'provider'],
        message: `Role ${when.role} does not use provider ${when.provider}`,
      });
    }
    return;
  }

  const option = options.get(when.option);
  if (option === undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: [...path, 'option'],
      message: `Unknown option in when condition: ${when.option}`,
    });
    return;
  }
  for (const [index, choice] of when.choices.entries()) {
    if (!option.choices.some((candidate) => candidate.id === choice)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [...path, 'choices', index],
        message: `Unknown choice for option ${when.option}: ${choice}`,
      });
    }
  }
}

export type WorkflowTemplateRole = z.infer<typeof workflowTemplateRoleSchema>;
export type WorkflowTemplateOptionChoice = z.infer<typeof workflowTemplateOptionChoiceSchema>;
export type WorkflowTemplateOption = z.infer<typeof workflowTemplateOptionSchema>;
export type WorkflowTemplateModel = z.infer<typeof workflowTemplateModelSchema>;
export type WorkflowTemplateWhen = z.infer<typeof workflowTemplateWhenSchema>;
export type WorkflowTemplateFlowStep = z.infer<typeof workflowTemplateFlowStepSchema>;
export type WorkflowTemplateWrite = z.infer<typeof workflowTemplateWriteSchema>;
export type WorkflowTemplatePrerequisite = z.infer<typeof workflowTemplatePrerequisiteSchema>;
export type WorkflowTemplateSlot = z.infer<typeof workflowTemplateSlotSchema>;
export type WorkflowTemplateSecret = z.infer<typeof workflowTemplateSecretSchema>;
export type WorkflowTemplateVariable = z.infer<typeof workflowTemplateVariableSchema>;
export type WorkflowTemplateManifest = z.infer<typeof workflowTemplateManifestSchema>;

export const templateManifestSchema = workflowTemplateManifestSchema;
export const manifestSchema = workflowTemplateManifestSchema;
export const roleSchema = workflowTemplateRoleSchema;
export const optionSchema = workflowTemplateOptionSchema;
