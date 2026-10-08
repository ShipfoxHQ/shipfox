import {logger} from '@shipfox/node-opentelemetry';
import {config} from '#config.js';
import type {RunnerTerminationReason} from '#core/entities/runner-instance.js';
import type {Tx} from '#db/db.js';
import {
  persistRunnerTerminationAuthorization,
  persistRunnerTerminationAuthorizationTx,
  type RunnerEnrollmentRevocationCounts,
  type TerminationAuthorizationResult,
  type TerminationAuthorizationTelemetry,
  type TerminationAuthorizationTxResult,
  type TerminationReasonResolution,
} from '#db/runner-instances.js';
import {
  recordRunnerEnrollmentCredentialRevoked,
  recordRunnerTerminationAuthorizationIssued,
  recordRunnerTerminationAuthorizationRejected,
} from '#metrics/index.js';

export interface RunnerTerminationAuthorizationParams {
  provisionerId: string;
  providerRunnerId: string;
  reason: string;
}

const isTerminationReasonEnabled: Record<RunnerTerminationReason, () => boolean> = {
  'registration-deadline': () => true,
  'activation-timeout': () => true,
  'runner-unresponsive': () => true,
  'lease-expired': () => true,
  'session-exhausted': () => true,
  'stopping-timeout': () => config.RUNNER_TERMINATION_REASON_STOPPING_TIMEOUT_ENABLED,
  'provider-health-failed': () => true,
  'job-cancelled': () => true,
  'job-timeout': () => true,
  'terminal-state': () => true,
};

const terminationReasons = new Set<string>(Object.keys(isTerminationReasonEnabled));

export async function authorizeRunnerTermination(
  params: RunnerTerminationAuthorizationParams,
): Promise<TerminationAuthorizationResult> {
  const result = await persistRunnerTerminationAuthorization({
    ...params,
    resolveTerminationReason: () => resolveRunnerTerminationReason(params),
  });
  recordRunnerTerminationAuthorizationTelemetry(params, result.telemetry);
  return withoutTelemetry(result);
}

export async function authorizeRunnerTerminationTx(
  tx: Tx,
  params: RunnerTerminationAuthorizationParams,
  onRevocation?: (counts: RunnerEnrollmentRevocationCounts) => void,
): Promise<TerminationAuthorizationTxResult> {
  return await persistRunnerTerminationAuthorizationTx(
    tx,
    {
      ...params,
      resolveTerminationReason: () => resolveRunnerTerminationReason(params),
    },
    onRevocation,
  );
}

export function recordRunnerTerminationAuthorizationTelemetry(
  params: RunnerTerminationAuthorizationParams,
  telemetry: TerminationAuthorizationTelemetry | null,
  revocationCounts?: RunnerEnrollmentRevocationCounts | null,
): void {
  if (revocationCounts) {
    recordRunnerEnrollmentCredentialRevoked({
      credential: 'activation-token',
      count: revocationCounts.revokedActivationTokenCount,
    });
    recordRunnerEnrollmentCredentialRevoked({
      credential: 'control-session',
      count: revocationCounts.closedControlSessionCount,
    });
    if (
      revocationCounts.revokedActivationTokenCount > 0 ||
      revocationCounts.closedControlSessionCount > 0
    )
      safelyLog(
        'info',
        {
          event: 'runner.enrollment_credentials_revoked',
          provisionerId: params.provisionerId,
          providerRunnerId: params.providerRunnerId,
          reason: params.reason,
        },
        'Revoked runner enrollment credentials after termination authorization',
      );
  }
  if (!telemetry) return;

  const fields = {
    component: 'api-runners',
    provisionerId: params.provisionerId,
    providerRunnerId: params.providerRunnerId,
    reason: telemetry.reason,
  };
  if (telemetry.outcome === 'issued') {
    recordRunnerTerminationAuthorizationIssued(telemetry.reason);
    safelyLog(
      'info',
      {...fields, event: 'runner.termination_authorization_issued'},
      'Runner termination authorization issued',
    );
  } else {
    recordRunnerTerminationAuthorizationRejected(telemetry.reason);
    safelyLog(
      'warn',
      {...fields, event: 'runner.termination_authorization_rejected'},
      'termination authorization rejected',
    );
  }
}

function safelyLog(
  level: 'info' | 'warn',
  fields: {
    event: string;
    provisionerId: string;
    providerRunnerId: string;
    reason: string;
  },
  message: string,
): void {
  try {
    logger()[level](fields, message);
  } catch {
    // Telemetry failures must not change authorization behavior.
  }
}

function withoutTelemetry(
  result: TerminationAuthorizationTxResult,
): TerminationAuthorizationResult {
  if (result.desiredIntent === 'keep')
    return {
      desiredIntent: 'keep',
      terminationAuthorizedAt: null,
      terminationReason: null,
    };
  return {
    desiredIntent: 'terminate',
    terminationAuthorizedAt: result.terminationAuthorizedAt,
    terminationReason: result.terminationReason,
  };
}

export function resolveRunnerTerminationReason(
  params: RunnerTerminationAuthorizationParams,
): TerminationReasonResolution {
  if (!terminationReasons.has(params.reason))
    return {reason: null, rejectionReason: 'unknown-reason'};

  const reason = params.reason as RunnerTerminationReason;
  if (!isTerminationReasonEnabled[reason]()) return {reason: null, rejectionReason: reason};

  return {reason};
}
