import {CONNECTION_SLUG_MAX_LENGTH} from '@shipfox/api-integration-core-dto';
import {ConnectionSlugConflictError} from '@shipfox/api-integration-spi';
import {isIntegrationConnectionSlugUniqueViolation} from '#db/connections.js';

const MAX_CONNECTION_SLUG_ATTEMPTS = 3;

export function slugifyConnectionSlug(input: string, options: {fallback: string}): string {
  const slug = normalizeSlug(input);
  if (slug) return slug;

  return normalizeSlug(options.fallback) || 'connection';
}

export async function retryConnectionSlugCollision<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!isIntegrationConnectionSlugUniqueViolation(error)) {
        throw error;
      }
      if (attempt >= MAX_CONNECTION_SLUG_ATTEMPTS) {
        throw new ConnectionSlugConflictError(error);
      }
    }
  }
}

function normalizeSlug(input: string): string {
  return input
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '_')
    .replaceAll(/^_+|_+$/g, '')
    .slice(0, CONNECTION_SLUG_MAX_LENGTH)
    .replaceAll(/_+$/g, '');
}
