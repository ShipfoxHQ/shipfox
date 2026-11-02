import {IntegrationProviderError} from '@shipfox/api-integration-spi';
import {reportError} from '@shipfox/node-error-monitoring';

export const MANAGED_REPOSITORY_BOUNDARY = 'integration.managed-repository';

/**
 * Keeps a storage failure a typed provider error, so sync can classify it. Anything
 * not already typed is unexpected, such as unreadable object bytes or a Postgres outage.
 */
export async function mapStoreFailure<T>(params: {
  operation: string;
  read: () => Promise<T>;
}): Promise<T> {
  try {
    return await params.read();
  } catch (error) {
    if (error instanceof IntegrationProviderError) throw error;
    reportError(error, {boundary: MANAGED_REPOSITORY_BOUNDARY, operation: params.operation});
    throw new IntegrationProviderError(
      'provider-unavailable',
      `The managed repository store failed during ${params.operation}`,
    );
  }
}
