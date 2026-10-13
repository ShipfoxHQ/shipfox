import type {WorkflowsModuleClient} from '@shipfox/api-workflows-dto/inter-module';
import {RunNotFoundError} from './errors.js';
import type {RunOrigin} from './scopes.js';

const SWEEP_THRESHOLD = 1000;

export interface RunOriginResolver {
  resolve(params: {
    workspaceId: string;
    workflowRunId: string;
    /** Lease expiry in epoch seconds. The origin of a run never changes, so it bounds the cache. */
    leaseExpiresAt: number;
  }): Promise<RunOrigin>;
}

export function createRunOriginResolver(
  workflows: Pick<WorkflowsModuleClient, 'getWorkflowRunOrigin'>,
): RunOriginResolver {
  const cache = new Map<string, {origin: RunOrigin; expiresAtMs: number}>();

  return {
    async resolve({workspaceId, workflowRunId, leaseExpiresAt}) {
      const cached = cache.get(workflowRunId);
      if (cached && cached.expiresAtMs > Date.now()) return cached.origin;

      const origin = await workflows.getWorkflowRunOrigin({workspaceId, workflowRunId});
      if (!origin) throw new RunNotFoundError(workflowRunId);

      if (cache.size >= SWEEP_THRESHOLD) {
        const now = Date.now();
        for (const [runId, entry] of cache) if (entry.expiresAtMs <= now) cache.delete(runId);
      }
      cache.set(workflowRunId, {origin, expiresAtMs: leaseExpiresAt * 1000});
      return origin;
    },
  };
}
