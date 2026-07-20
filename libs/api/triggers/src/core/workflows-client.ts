import {
  type WorkflowsModuleClient,
  workflowsInterModuleContract,
} from '@shipfox/api-workflows-dto/inter-module';
import {isInterModuleKnownError} from '@shipfox/inter-module';

export type {WorkflowsModuleClient};

/**
 * Workflows declares only failures that can never succeed on retry for trigger
 * run creation. Every other outcome is opaque and must remain retryable because
 * it may have committed before the caller stopped waiting.
 */
export function isPermanentStartRunError(error: unknown): boolean {
  return isInterModuleKnownError(workflowsInterModuleContract.methods.startRunFromTrigger, error);
}

export function isInterpolationUnresolvableError(
  error: unknown,
): error is Extract<ReturnType<typeof startRunKnownError>, {code: 'interpolation-unresolvable'}> {
  return (
    isInterModuleKnownError(workflowsInterModuleContract.methods.startRunFromTrigger, error) &&
    error.code === 'interpolation-unresolvable'
  );
}

function startRunKnownError(error: unknown) {
  if (!isInterModuleKnownError(workflowsInterModuleContract.methods.startRunFromTrigger, error)) {
    return undefined;
  }
  return error;
}
