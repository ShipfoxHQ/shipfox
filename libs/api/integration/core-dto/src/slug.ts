import {z} from 'zod';

export const CONNECTION_SLUG_MAX_LENGTH = 100;

export const connectionSlugSchema = z
  .string()
  .min(1)
  .max(CONNECTION_SLUG_MAX_LENGTH)
  .regex(/^[a-z0-9]+(?:[_-][a-z0-9]+)*$/);

export function slugifyConnectionSlug(input: string, options: {fallback: string}): string {
  const slug = normalizeSlug(input);
  if (slug) return slug;

  const fallback = normalizeSlug(options.fallback);
  return fallback || 'connection';
}

function normalizeSlug(input: string): string {
  return input
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '_')
    .replaceAll(/^_+|_+$/g, '')
    .slice(0, CONNECTION_SLUG_MAX_LENGTH)
    .replaceAll(/_+$/g, '');
}
