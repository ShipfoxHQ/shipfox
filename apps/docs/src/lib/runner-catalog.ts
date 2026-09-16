import {z} from 'zod';
import {config} from '@/config';

const positiveInteger = z.number().int().positive();
const identifier = z.string().min(1);
const TRAILING_SLASH_PATTERN = /\/$/;
const TRAILING_ZERO_PATTERN = /0+$/;

const runnerSchema = z
  .object({
    id: identifier,
    label: identifier,
    aliases: z.array(identifier),
    sku: identifier,
    class: identifier,
    operating_system: identifier,
    architecture: identifier,
    cpu: positiveInteger,
    memory_gib: positiveInteger,
    workspace_disk_gib: positiveInteger,
    system_disk_gib: positiveInteger,
    pricing: z
      .object({
        unit: z.literal('minute'),
        minimum_seconds: positiveInteger,
        price_microdollars: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict();

const runnerCatalogSchema = z
  .object({
    schema_version: z.literal(1),
    catalog_version: identifier,
    rate_card_version: identifier,
    effective_at: z.string().datetime({offset: true}),
    currency: z.literal('USD'),
    runners: z.array(runnerSchema).min(1),
  })
  .strict();

export type Runner = z.infer<typeof runnerSchema>;
export type RunnerCatalog = z.infer<typeof runnerCatalogSchema>;
export function parseRunnerCatalog(value: unknown): RunnerCatalog {
  const catalog = runnerCatalogSchema.parse(value);
  const ids = new Set<string>();
  const skus = new Set<string>();
  const names = new Set<string>();

  for (const runner of catalog.runners) {
    if (ids.has(runner.id)) throw new Error(`Runner catalog contains duplicate ID "${runner.id}".`);
    if (skus.has(runner.sku))
      throw new Error(`Runner catalog contains duplicate SKU "${runner.sku}".`);
    ids.add(runner.id);
    skus.add(runner.sku);

    for (const name of [runner.id, ...runner.aliases]) {
      if (names.has(name))
        throw new Error(`Runner catalog contains duplicate runner name "${name}".`);
      names.add(name);
    }
  }

  return catalog;
}

export function formatMicrodollars(value: number): string {
  const wholeDollars = Math.floor(value / 1_000_000);
  const fractional = String(value % 1_000_000)
    .padStart(6, '0')
    .replace(TRAILING_ZERO_PATTERN, '');
  return fractional ? `$${wholeDollars}.${fractional}` : `$${wholeDollars}`;
}

export function formatRunnerPrice(runner: Runner): string {
  return `${formatMicrodollars(runner.pricing.price_microdollars)}/${runner.pricing.unit}`;
}

export function renderRunnerCatalogMarkdown(catalog: RunnerCatalog): string {
  const rows = catalog.runners.map((runner) => {
    const aliases =
      runner.aliases.length > 0
        ? `<br />${runner.aliases.length === 1 ? 'Alias' : 'Aliases'}: ${runner.aliases.map((alias) => `\`${alias}\``).join(', ')}`
        : '';
    return [
      `| \`${runner.id}\`${aliases} | ${runner.cpu} vCPU · ${runner.memory_gib} GiB | ${runner.workspace_disk_gib} GiB | ${formatRunnerPrice(runner)} |`,
    ].join('');
  });

  return [
    '| Runner | Compute | Workspace disk | Price |',
    '| --- | ---: | ---: | ---: |',
    ...rows,
  ].join('\n');
}

export interface RunnerCatalogClientOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  cache?: RunnerCatalogCache;
  now?: () => number;
  cacheTtlMs?: number;
}

export interface RunnerCatalogCache {
  catalog?: RunnerCatalog;
  fetchedAt?: number;
}

export function createRunnerCatalogClient(options: RunnerCatalogClientOptions = {}) {
  const baseUrl = options.baseUrl ?? config.API_PUBLIC_URL;
  const fetchImpl = options.fetchImpl ?? fetch;
  const cache = options.cache ?? {};
  const now = options.now ?? Date.now;
  const cacheTtlMs = options.cacheTtlMs ?? 300_000;
  const endpoint = new URL(
    '/catalog/runners',
    `${baseUrl.replace(TRAILING_SLASH_PATTERN, '')}/`,
  ).toString();

  return {
    endpoint,
    async get(): Promise<RunnerCatalog> {
      if (cache.catalog && cache.fetchedAt !== undefined && now() - cache.fetchedAt < cacheTtlMs) {
        return cache.catalog;
      }

      try {
        const response = await fetchImpl(endpoint, {
          headers: {accept: 'application/json'},
          next: {revalidate: 300},
        });
        if (!response.ok) throw new Error(`Catalog request failed with HTTP ${response.status}.`);
        const catalog = parseRunnerCatalog(await response.json());
        cache.catalog = catalog;
        cache.fetchedAt = now();
        return catalog;
      } catch (error) {
        if (cache.catalog) return cache.catalog;
        throw new Error('The public runner catalog could not be loaded.', {cause: error});
      }
    },
  };
}

export const runnerCatalogClient = createRunnerCatalogClient();
export const getRunnerCatalog = () => runnerCatalogClient.get();
