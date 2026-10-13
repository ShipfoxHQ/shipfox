import {requireLeasedJobContext} from '@shipfox/api-auth-context';
import type {WorkflowsModuleClient} from '@shipfox/api-workflows-dto/inter-module';
import {ClientError} from '@shipfox/node-fastify';
import {
  CacheEntryNotCommittableError,
  CacheEntryNotFoundError,
  EntryTooLargeError,
  InvalidUploadError,
  ReservedScopeError,
  RunNotFoundError,
  UploadAbortedError,
  UploadObjectMissingError,
  UploadSizeMismatchError,
} from '#core/errors.js';
import type {CacheLease} from '#core/lease.js';
import {createRunOriginResolver} from '#core/run-origin.js';
import {assertScopeNotReserved, createScopeView, type ScopeView} from '#core/scopes.js';
import type {WorkspaceStorageLimits} from '#core/storage-policy.js';

type RequestWithLease = Parameters<typeof requireLeasedJobContext>[0];

export interface CacheRequestContext {
  limits: WorkspaceStorageLimits;
  lease(request: RequestWithLease): CacheLease;
  /** Rejects reserved scopes, then maps the run's authored scopes to its stored scopes. */
  scopes(request: RequestWithLease, authoredScopes: string[]): Promise<ScopeView>;
}

/** Workspace and project always come from the lease, never from a body. */
export function createCacheRequestContext(
  workflows: Pick<WorkflowsModuleClient, 'getWorkflowRunOrigin'>,
  limits: WorkspaceStorageLimits,
): CacheRequestContext {
  const origins = createRunOriginResolver(workflows);

  return {
    limits,
    lease(request) {
      const claims = requireLeasedJobContext(request);
      return {
        workspaceId: claims.workspaceId,
        projectId: claims.projectId,
        workflowRunId: claims.workflowRunId,
        jobExecutionId: claims.jobExecutionId,
      };
    },
    async scopes(request, authoredScopes) {
      for (const scope of authoredScopes) assertScopeNotReserved(scope);
      const claims = requireLeasedJobContext(request);
      return createScopeView(
        await origins.resolve({
          workspaceId: claims.workspaceId,
          workflowRunId: claims.workflowRunId,
          leaseExpiresAt: claims.exp,
        }),
      );
    },
  };
}

export function translateCacheError(error: unknown): never {
  if (error instanceof ReservedScopeError) {
    throw new ClientError(error.message, 'reserved-scope', {status: 400});
  }
  if (error instanceof RunNotFoundError) {
    throw new ClientError('Workflow run not found for this lease', 'run-not-found', {status: 404});
  }
  if (error instanceof CacheEntryNotFoundError) {
    throw new ClientError('Cache entry not found', 'entry-not-found', {status: 404});
  }
  if (error instanceof CacheEntryNotCommittableError) {
    throw new ClientError(error.message, 'entry-not-committable', {status: 409});
  }
  if (error instanceof InvalidUploadError) {
    throw new ClientError(error.message, 'invalid-upload', {status: 409});
  }
  if (error instanceof EntryTooLargeError) {
    throw new ClientError(error.message, 'entry-too-large', {status: 409});
  }
  if (error instanceof UploadAbortedError) {
    throw new ClientError(error.message, 'upload-aborted', {status: 409});
  }
  if (error instanceof UploadObjectMissingError) {
    throw new ClientError(error.message, 'object-missing', {status: 409});
  }
  if (error instanceof UploadSizeMismatchError) {
    throw new ClientError(error.message, 'size-mismatch', {status: 409});
  }
  throw error;
}
