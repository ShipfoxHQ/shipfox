import {z} from 'zod';
import {inlineCode, tableValue} from './markdown';

const MILLION_TOKENS = 'million_tokens';
const THOUSAND_REQUESTS = 'thousand_requests';
const MODEL_CATALOG_REVALIDATE_SECONDS = 300;
const TRAILING_ZEROES_PATTERN = /0+$/;
const TOKEN_COUNT_FORMATTER = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 2,
  notation: 'compact',
});

const priceSchema = (unit: typeof MILLION_TOKENS | typeof THOUSAND_REQUESTS) =>
  z
    .object({
      unit: z.literal(unit),
      price_microdollars: z.number().int().nonnegative().safe(),
    })
    .strict();

const modelPricingSchema = z
  .object({
    input: priceSchema(MILLION_TOKENS).nullable(),
    cached_input: priceSchema(MILLION_TOKENS).nullable(),
    cache_write: priceSchema(MILLION_TOKENS).nullable(),
    output: priceSchema(MILLION_TOKENS).nullable(),
    web_search: priceSchema(THOUSAND_REQUESTS).nullable(),
  })
  .strict();

const modelSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    sku: z.string().min(1),
    capabilities: z
      .object({
        context_window_tokens: z.number().int().positive().safe(),
        max_output_tokens: z.number().int().positive().safe(),
        image_input: z.boolean(),
        reasoning: z.boolean(),
      })
      .strict(),
    pricing: modelPricingSchema,
  })
  .strict();

export const modelCatalogSchema = z
  .object({
    schema_version: z.literal(1),
    catalog_version: z.string().min(1),
    rate_card_version: z.string().min(1),
    effective_at: z.string().datetime({offset: true}),
    currency: z.literal('USD'),
    pricing_policy: z
      .object({
        type: z.literal('reference-rate-markup'),
        markup_basis_points: z.literal(500),
      })
      .strict(),
    models: z
      .array(modelSchema)
      .min(1)
      .refine((models) => new Set(models.map((model) => model.id)).size === models.length, {
        message: 'Model IDs must be unique.',
      }),
  })
  .strict();

export type ModelCatalog = z.infer<typeof modelCatalogSchema>;
export type CatalogModel = ModelCatalog['models'][number];
export type ModelPricing = CatalogModel['pricing'];
export type ModelPrice = NonNullable<ModelPricing[keyof ModelPricing]>;

type CatalogFetchInit = RequestInit & {
  next?: {
    revalidate: number;
    tags: string[];
  };
};

type CatalogFetcher = (input: URL, init: CatalogFetchInit) => Promise<Response>;

export class ModelCatalogRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ModelCatalogRequestError';
  }
}

export interface ModelCatalogClient {
  getModelCatalog(): Promise<ModelCatalog>;
}

export function createModelCatalogClient(options: {
  apiUrl: string;
  fetcher?: CatalogFetcher;
}): ModelCatalogClient {
  const fetcher = options.fetcher ?? ((input, init) => fetch(input, init));
  let lastSuccessfulCatalog: ModelCatalog | undefined;

  return {
    async getModelCatalog() {
      try {
        const response = await fetcher(new URL('/catalog/models', options.apiUrl), {
          headers: {accept: 'application/json'},
          next: {
            revalidate: MODEL_CATALOG_REVALIDATE_SECONDS,
            tags: ['model-catalog'],
          },
        });

        if (!response.ok) {
          throw new ModelCatalogRequestError(
            `Model catalog request failed with HTTP ${response.status}.`,
          );
        }

        const parsed = modelCatalogSchema.safeParse(await response.json());
        if (!parsed.success) {
          throw new ModelCatalogRequestError('Model catalog response failed validation.');
        }

        lastSuccessfulCatalog = parsed.data;
        return parsed.data;
      } catch (error) {
        if (lastSuccessfulCatalog) return lastSuccessfulCatalog;
        throw error;
      }
    },
  };
}

export function formatMicrodollars(priceMicrodollars: number): string {
  const amount = BigInt(priceMicrodollars);
  const wholeDollars = amount / 1_000_000n;
  const fractionalDollars = (amount % 1_000_000n)
    .toString()
    .padStart(6, '0')
    .replace(TRAILING_ZEROES_PATTERN, '')
    .padEnd(2, '0');
  return `$${wholeDollars}.${fractionalDollars}`;
}

export function formatTokenCount(tokenCount: number): string {
  return `${TOKEN_COUNT_FORMATTER.format(tokenCount)} tok`;
}

export function formatModelCapabilities(capabilities: CatalogModel['capabilities']): string {
  return [
    `Context: ${formatTokenCount(capabilities.context_window_tokens)}`,
    `Max output: ${formatTokenCount(capabilities.max_output_tokens)}`,
    ...(capabilities.image_input ? ['Image input'] : []),
    ...(capabilities.reasoning ? ['Reasoning'] : []),
  ].join('; ');
}

export function formatModelPrice(price: ModelPrice | null): string {
  return price === null ? 'N/A' : formatMicrodollars(price.price_microdollars);
}

export function serializeModelCatalog(catalog: ModelCatalog): string {
  const rows = catalog.models.map((model) => {
    const prices = model.pricing;
    return [
      `| ${tableValue(model.label)} | ${inlineCode(model.id)} | ${tableValue(formatModelCapabilities(model.capabilities))} | ${formatModelPrice(prices.input)} | ${formatModelPrice(prices.cached_input)} | ${formatModelPrice(prices.cache_write)} | ${formatModelPrice(prices.output)} | ${formatModelPrice(prices.web_search)} |`,
    ].join('\n');
  });

  return [
    '## Available models',
    '',
    '| Model | `model` ID | Capabilities | Input / 1M tokens | Cached input / 1M tokens | Cache write / 1M tokens | Output / 1M tokens | Web search / 1K requests |',
    '| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |',
    ...rows,
  ].join('\n');
}
