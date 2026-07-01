import {z} from 'zod';
import {agentProviderRefSchema, isReservedAgentProviderId} from './provider-id.js';

const MAX_HEADER_COUNT = 32;
const MAX_MODEL_COUNT = 128;

const headerNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/)
  .transform((name) => name.toLowerCase());

const headerValueSchema = z.string().min(1).max(8192);
const modelIdSchema = z.string().min(1).max(128);

export const agentProviderApiSchema = z.enum([
  'openai-completions',
  'openai-responses',
  'anthropic-messages',
  'google-generative-ai',
]);

export type AgentProviderApi = z.infer<typeof agentProviderApiSchema>;

export const customAgentModelSchema = z.object({
  id: modelIdSchema,
  label: z.string().min(1).max(160),
  context_window: z.number().int().positive().optional(),
  max_output_tokens: z.number().int().positive().optional(),
  input_image: z.boolean().optional(),
  reasoning: z.boolean().optional(),
});

export type CustomAgentModelDto = z.infer<typeof customAgentModelSchema>;

export const customProviderHeaderDtoSchema = z.object({
  name: headerNameSchema,
  value: headerValueSchema,
});

export type CustomProviderHeaderDto = z.infer<typeof customProviderHeaderDtoSchema>;

export const customProviderHeaderRequestSchema = customProviderHeaderDtoSchema.extend({
  secret: z.boolean(),
});

export type CustomProviderHeaderRequestDto = z.infer<typeof customProviderHeaderRequestSchema>;

const customProviderHeadersRequestSchema = z
  .array(customProviderHeaderRequestSchema)
  .max(MAX_HEADER_COUNT)
  .superRefine(assertUniqueHeaderNames);

const customProviderHeadersDtoSchema = z
  .array(customProviderHeaderDtoSchema)
  .max(MAX_HEADER_COUNT)
  .superRefine(assertUniqueHeaderNames);

const customProviderModelsSchema = z
  .array(customAgentModelSchema)
  .min(1)
  .max(MAX_MODEL_COUNT)
  .superRefine(assertUniqueModelIds);

const customProviderBodyFields = {
  display_name: z.string().min(1).max(120),
  api: agentProviderApiSchema,
  base_url: z.string().url().max(2048),
  api_key: z.string().min(1).max(8192).optional(),
  headers: customProviderHeadersRequestSchema.optional(),
  models: customProviderModelsSchema,
  default_model: modelIdSchema.nullable().optional(),
};

export const createCustomAgentProviderBodySchema = z
  .object({
    slug: agentProviderRefSchema.refine((slug) => !isReservedAgentProviderId(slug), {
      message: 'Provider id is reserved.',
    }),
    ...customProviderBodyFields,
  })
  .superRefine(assertDefaultModelInModels);

export type CreateCustomAgentProviderBodyDto = z.infer<typeof createCustomAgentProviderBodySchema>;

export const updateCustomAgentProviderBodySchema = z
  .object({
    ...customProviderBodyFields,
    models: customProviderModelsSchema.optional(),
  })
  .partial()
  .superRefine((body, ctx) => {
    if (body.models === undefined) return;
    assertDefaultModelInModels(body, ctx);
  });

export type UpdateCustomAgentProviderBodyDto = z.infer<typeof updateCustomAgentProviderBodySchema>;

export const customAgentProviderRuntimeConfigSchema = z.object({
  api: agentProviderApiSchema,
  base_url: z.string().url().max(2048),
  headers: customProviderHeadersDtoSchema,
  secret_header_names: z
    .array(headerNameSchema)
    .max(MAX_HEADER_COUNT)
    .superRefine(assertUniqueStrings),
  models: customProviderModelsSchema,
});

export type CustomAgentProviderRuntimeConfigDto = z.infer<
  typeof customAgentProviderRuntimeConfigSchema
>;

export const customAgentProviderConfigDtoSchema = customAgentProviderRuntimeConfigSchema.extend({
  kind: z.literal('custom'),
  provider_id: agentProviderRefSchema,
  display_name: z.string().min(1).max(120),
  default_model: modelIdSchema.nullable(),
  key_fingerprints: z.record(z.string().regex(/^credential:.+/), z.string()),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

export type CustomAgentProviderConfigDto = z.infer<typeof customAgentProviderConfigDtoSchema>;

function assertDefaultModelInModels(
  body: {default_model?: string | null | undefined; models?: CustomAgentModelDto[] | undefined},
  ctx: z.RefinementCtx,
): void {
  if (typeof body.default_model !== 'string' || body.models === undefined) return;

  if (!body.models.some((model) => model.id === body.default_model)) {
    ctx.addIssue({
      code: 'custom',
      path: ['default_model'],
      message: 'Default model must be one of the configured models.',
    });
  }
}

function assertUniqueHeaderNames(headers: Array<{name: string}>, ctx: z.RefinementCtx): void {
  assertUniqueStrings(
    headers.map((header) => header.name),
    ctx,
  );
}

function assertUniqueModelIds(models: CustomAgentModelDto[], ctx: z.RefinementCtx): void {
  assertUniqueStrings(
    models.map((model) => model.id),
    ctx,
  );
}

function assertUniqueStrings(values: string[], ctx: z.RefinementCtx): void {
  const seen = new Set<string>();
  for (const [index, value] of values.entries()) {
    if (!seen.has(value)) {
      seen.add(value);
      continue;
    }

    ctx.addIssue({
      code: 'custom',
      path: [index],
      message: 'Duplicate value.',
    });
  }
}
