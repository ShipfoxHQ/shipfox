import type {WorkflowRunOverviewResponseDto} from '@shipfox/api-workflows-dto';

type Job = Extract<WorkflowRunOverviewResponseDto['jobs'], {kind: 'complete'}>['items'][number];

export function jobOverview(params: {
  key: string;
  mode?: Job['mode'];
  status?: Job['status'];
  listenerStatus?: Job['listener_status'];
}): Job {
  const counts = {pending: 0, running: 0, succeeded: 0, failed: 0, cancelled: 0};
  return {
    id: crypto.randomUUID(),
    key: params.key,
    name: null,
    position: 0,
    dependencies: [],
    status: params.status ?? 'succeeded',
    status_reason: null,
    mode: params.mode ?? 'one_shot',
    listener_status: params.listenerStatus ?? 'inactive',
    carried_over: false,
    execution_count: 0,
    execution_status_counts: counts,
    default_execution: null,
  };
}

/** A run overview with the facts the delivery check reads. The rest is filler. */
export function runOverview(params: {
  runId: string;
  attemptId?: string;
  attempt?: number;
  status?: WorkflowRunOverviewResponseDto['attempt']['status'];
  outputs?: Record<string, unknown> | null;
  jobs?: Job[];
  large?: boolean;
}): WorkflowRunOverviewResponseDto {
  const jobs = params.jobs ?? [];
  const now = new Date().toISOString();
  return {
    run: {
      id: params.runId,
      project_id: crypto.randomUUID(),
      definition_id: crypto.randomUUID(),
      number: 7,
      name: 'Implement',
      workflow_name: 'implement',
      origin: 'synced',
      dev_source: null,
      trigger_provider: null,
      trigger_source: 'manual',
      trigger_event: 'manual',
      trigger_reference: null,
      secret_inputs: null,
      parent_run: null,
      conversation: null,
      created_at: now,
    },
    attempt: {
      id: params.attemptId ?? crypto.randomUUID(),
      workflow_run_id: params.runId,
      attempt: params.attempt ?? 1,
      status: params.status ?? 'running',
      created_at: now,
      started_at: now,
      finished_at: null,
      rerun_mode: null,
      status_reason: null,
      status_reason_message: null,
      outputs: params.outputs ?? null,
    },
    has_started_job_execution: true,
    jobs: params.large
      ? {
          kind: 'large',
          total: jobs.length,
          status_counts: [],
          first_page: {items: [], next_cursor: null, total: jobs.length},
        }
      : {kind: 'complete', total: jobs.length, items: jobs},
  };
}
