import type {
  ActiveRunner,
  ReconcileProvisionedRunnersResult,
  ReportProvisionedRunnersResult,
} from '#core/provisioned-runners.js';

export function toReportProvisionedRunnersResponseDto(result: ReportProvisionedRunnersResult): {
  accepted: number;
  reservations_released: number;
} {
  return {
    accepted: result.accepted,
    reservations_released: result.reservationsReleased,
  };
}

export function toReconcileProvisionedRunnersResponseDto(
  result: ReconcileProvisionedRunnersResult,
): {
  runners: Array<{
    provisioned_runner_id: string;
    state: ReconcileProvisionedRunnersResult['runners'][number]['state'];
    reservation_id: string | null;
    runner_session_id: string | null;
    bound_job: {
      job_id: string;
      run_id: string;
      last_heartbeat_at: string;
      cancellation_requested_at: string | null;
    } | null;
    desired_intent: ReconcileProvisionedRunnersResult['runners'][number]['desiredIntent'];
  }>;
  terminated_absent_provisioned_runner_ids: string[];
} {
  return {
    runners: result.runners.map((runner) => ({
      provisioned_runner_id: runner.provisionedRunnerId,
      state: runner.state,
      reservation_id: runner.reservationId,
      runner_session_id: runner.runnerSessionId,
      bound_job: runner.boundJob
        ? {
            job_id: runner.boundJob.jobId,
            run_id: runner.boundJob.runId,
            last_heartbeat_at: runner.boundJob.lastHeartbeatAt.toISOString(),
            cancellation_requested_at:
              runner.boundJob.cancellationRequestedAt?.toISOString() ?? null,
          }
        : null,
      desired_intent: runner.desiredIntent,
    })),
    terminated_absent_provisioned_runner_ids: result.terminatedAbsentProvisionedRunnerIds,
  };
}

export function toActiveRunnersResponseDto(runners: ActiveRunner[]): {
  runners: Array<{
    runner_session_id: string | null;
    provisioned_runner_id: string | null;
    provisioner_id: string | null;
    state: ActiveRunner['state'];
    labels: string[];
    template_key: string | null;
    provider_kind: string | null;
    job_id: string | null;
    run_id: string | null;
    project_id: string | null;
    reported_at: string | null;
    last_heartbeat_at: string | null;
  }>;
} {
  return {
    runners: runners.map((runner) => ({
      runner_session_id: runner.runnerSessionId,
      provisioned_runner_id: runner.provisionedRunnerId,
      provisioner_id: runner.provisionerId,
      state: runner.state,
      labels: runner.labels,
      template_key: runner.templateKey,
      provider_kind: runner.providerKind,
      job_id: runner.jobId,
      run_id: runner.runId,
      project_id: runner.projectId,
      reported_at: runner.reportedAt?.toISOString() ?? null,
      last_heartbeat_at: runner.lastHeartbeatAt?.toISOString() ?? null,
    })),
  };
}
