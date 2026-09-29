import type {PolicyNotice} from '@shipfox/policy-notice';

export interface JobExecutionLimits {
  /** Upper bound on running time for installation-scope runners. */
  maxExecutionMs: number | null;
  /** Default running time for installation-scope runners without a request. */
  defaultExecutionMs: number | null;
  /** Observe computes a cap but lets the requested duration run. */
  mode: 'enforce' | 'observe';
  /** Customer-facing notice shown when enforcement shortens a job. */
  capNotice?: PolicyNotice | undefined;
}

export interface JobExecutionLimitsInput {
  workspaceId: string;
  projectId: string;
  jobExecutionId: string;
}

export interface JobExecutionLimitsPolicy {
  resolve(input: JobExecutionLimitsInput): Promise<JobExecutionLimits>;
}

export const DEFAULT_EXECUTION_MAX_DURATION_MS = 6 * 60 * 60 * 1000;

export interface JobExecutionDurationResolution {
  requestedMs: number;
  effectiveMs: number;
  outcome: 'within' | 'capped' | 'would_cap';
  capped: boolean;
  notice: PolicyNotice | null;
}

export function resolveJobExecutionDuration(params: {
  requestedMs: number | null | undefined;
  provisionerScope: string | null | undefined;
  limits: JobExecutionLimits | null | undefined;
}): JobExecutionDurationResolution {
  const managed = params.provisionerScope === 'installation';
  const requestedMs =
    params.requestedMs ??
    (managed
      ? (params.limits?.defaultExecutionMs ?? DEFAULT_EXECUTION_MAX_DURATION_MS)
      : DEFAULT_EXECUTION_MAX_DURATION_MS);
  const limitedMs =
    managed && params.limits?.maxExecutionMs != null
      ? Math.min(requestedMs, params.limits.maxExecutionMs)
      : requestedMs;
  const wouldCap = limitedMs < requestedMs;
  const enforced = params.limits?.mode !== 'observe';

  let outcome: JobExecutionDurationResolution['outcome'] = 'within';
  if (wouldCap) outcome = enforced ? 'capped' : 'would_cap';

  return {
    requestedMs,
    effectiveMs: enforced ? limitedMs : requestedMs,
    outcome,
    capped: wouldCap && enforced,
    notice: wouldCap && enforced ? (params.limits?.capNotice ?? null) : null,
  };
}
