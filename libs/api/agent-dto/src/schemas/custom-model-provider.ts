import {z} from 'zod';
import {isReservedModelProviderId, modelProviderRefSchema} from './model-provider-id.js';

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
const fingerprintKeySchema = z.string().regex(/^(credential|header):.+/);

export const modelProviderApiSchema = z.enum([
  'openai-completions',
  'openai-responses',
  'anthropic-messages',
  'google-generative-ai',
]);

export type ModelProviderApi = z.infer<typeof modelProviderApiSchema>;

export const customAgentModelSchema = z.object({
  id: modelIdSchema,
  label: z.string().min(1).max(160),
  context_window: z.number().int().positive().optional(),
  max_output_tokens: z.number().int().positive().optional(),
  input_image: z.boolean().optional(),
  reasoning: z.boolean().optional(),
});

export type CustomAgentModelDto = z.infer<typeof customAgentModelSchema>;

export const customModelProviderHeaderDtoSchema = z.object({
  name: headerNameSchema,
  value: headerValueSchema,
});

export type CustomModelProviderHeaderDto = z.infer<typeof customModelProviderHeaderDtoSchema>;

export const customModelProviderHeaderRequestSchema = customModelProviderHeaderDtoSchema.extend({
  secret: z.boolean(),
});

export type CustomModelProviderHeaderRequestDto = z.infer<
  typeof customModelProviderHeaderRequestSchema
>;

const customModelProviderHeadersRequestSchema = z
  .array(customModelProviderHeaderRequestSchema)
  .max(MAX_HEADER_COUNT)
  .superRefine(assertUniqueHeaderNames);

const customModelProviderHeadersDtoSchema = z
  .array(customModelProviderHeaderDtoSchema)
  .max(MAX_HEADER_COUNT)
  .superRefine(assertUniqueHeaderNames);

const customModelProviderModelsSchema = z
  .array(customAgentModelSchema)
  .min(1)
  .max(MAX_MODEL_COUNT)
  .superRefine(assertUniqueModelIds);

const customModelProviderBodyFields = {
  display_name: z.string().min(1).max(120),
  api: modelProviderApiSchema,
  base_url: z.string().url().max(2048),
  api_key: z.string().min(1).max(8192).optional(),
  headers: customModelProviderHeadersRequestSchema.optional(),
  models: customModelProviderModelsSchema,
  default_model: modelIdSchema.nullable().optional(),
};

export const createCustomModelProviderBodySchema = z
  .object({
    slug: modelProviderRefSchema.refine((slug) => !isReservedModelProviderId(slug), {
      message: 'Provider id is reserved.',
    }),
    ...customModelProviderBodyFields,
  })
  .superRefine(assertDefaultModelInModels);

export type CreateCustomModelProviderBodyDto = z.infer<typeof createCustomModelProviderBodySchema>;

export const updateCustomModelProviderBodySchema = z
  .object({
    ...customModelProviderBodyFields,
    models: customModelProviderModelsSchema.optional(),
  })
  .partial()
  .superRefine((body, ctx) => {
    if (body.models === undefined) return;
    assertDefaultModelInModels(body, ctx);
  });

export type UpdateCustomModelProviderBodyDto = z.infer<typeof updateCustomModelProviderBodySchema>;

export const customModelProviderRuntimeConfigSchema = z.object({
  api: modelProviderApiSchema,
  base_url: z.string().url().max(2048),
  headers: customModelProviderHeadersDtoSchema,
  secret_header_names: z
    .array(headerNameSchema)
    .max(MAX_HEADER_COUNT)
    .superRefine(assertUniqueStrings),
  models: customModelProviderModelsSchema,
});

export type CustomModelProviderRuntimeConfigDto = z.infer<
  typeof customModelProviderRuntimeConfigSchema
>;

export const customModelProviderConfigDtoSchema = customModelProviderRuntimeConfigSchema.extend({
  kind: z.literal('custom'),
  provider_id: modelProviderRefSchema,
  display_name: z.string().min(1).max(120),
  default_model: modelIdSchema.nullable(),
  key_fingerprints: z.record(fingerprintKeySchema, z.string()),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

export type CustomModelProviderConfigDto = z.infer<typeof customModelProviderConfigDtoSchema>;

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
