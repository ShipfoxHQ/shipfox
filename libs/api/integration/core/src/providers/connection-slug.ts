import {ConnectionSlugConflictError} from '@shipfox/api-integration-core-dto';
import {isIntegrationConnectionSlugUniqueViolation} from '#db/connections.js';

const MAX_CONNECTION_SLUG_ATTEMPTS = 3;

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
