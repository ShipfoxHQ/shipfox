import {
  workflowJobDto,
  workflowRunAttemptDto,
  workflowRunDetailDto,
  workflowRunDto,
  workflowRunListResponseDto,
  workflowStepAttemptDto,
  workflowStepDto,
} from '#test/fixtures/workflow-run.js';
import {
  isWorkflowRunTerminal,
  isWorkflowStatus,
  toWorkflowRun,
  toWorkflowRunAttempt,
  toWorkflowRunDetail,
  toWorkflowRunListPage,
  workflowRunShortId,
  workflowRunTriggerDisplayLabel,
  workflowRunTriggerLabel,
} from './workflow-run.js';

describe('workflow run model mapping', () => {
  test('maps a run DTO into the central camelCase model', () => {
    const dto = workflowRunDto({
      id: '66666666-6666-4666-8666-666666666666',
      project_id: '44444444-4444-4444-8444-444444444444',
      definition_id: '55555555-5555-4555-8555-555555555555',
      name: 'deploy-web',
      status: 'running',
      current_attempt: 3,
      latest_attempt: 4,
      trigger_source: 'github',
      trigger_event: 'push',
      trigger_payload: {ref: 'refs/heads/main'},
      inputs: {environment: 'production'},
      source_snapshot: {format: 'yaml', content: 'jobs: {}'},
      created_at: '2026-05-07T01:01:00.000Z',
      updated_at: '2026-05-07T01:02:00.000Z',
      started_at: '2026-05-07T01:01:10.000Z',
      finished_at: null,
    });

    const run = toWorkflowRun(dto as Parameters<typeof toWorkflowRun>[0]);

    expect(run).toMatchObject({
      id: '66666666-6666-4666-8666-666666666666',
      projectId: '44444444-4444-4444-8444-444444444444',
      definitionId: '55555555-5555-4555-8555-555555555555',
      name: 'deploy-web',
      status: 'running',
      currentAttempt: 3,
      triggerSource: 'github',
      triggerEvent: 'push',
      triggerDisplayLabel: 'push',
      triggerLabel: 'github · push',
      triggerPayload: {ref: 'refs/heads/main'},
      inputs: {environment: 'production'},
      sourceSnapshot: {format: 'yaml', content: 'jobs: {}'},
      createdAt: '2026-05-07T01:01:00.000Z',
      updatedAt: '2026-05-07T01:02:00.000Z',
      startedAt: '2026-05-07T01:01:10.000Z',
      finishedAt: null,
      shortId: '66666666',
      isTemporary: false,
    });
  });

  test('normalizes missing nullable fields and marks temporary optimistic runs', () => {
    const dto = {
      ...workflowRunDto({
        id: 'temp-1234',
        trigger_source: '',
        trigger_event: '',
      }),
      inputs: undefined,
      source_snapshot: undefined,
      started_at: undefined,
      finished_at: undefined,
    };

    const run = toWorkflowRun(dto as unknown as Parameters<typeof toWorkflowRun>[0]);

    expect(run).toMatchObject({
      triggerDisplayLabel: '',
      triggerLabel: '',
      inputs: null,
      sourceSnapshot: null,
      startedAt: null,
      finishedAt: null,
      shortId: 'temp-123',
      isTemporary: true,
    });
  });

  test('maps run list pagination fields', () => {
    const dto = workflowRunListResponseDto({
      runs: [
        workflowRunDto({id: '66666666-6666-4666-8666-000000000001'}),
        workflowRunDto({id: '66666666-6666-4666-8666-000000000002'}),
      ],
      next_cursor: 'cursor-2',
      filtered_total_count: 12,
    });

    const page = toWorkflowRunListPage(dto);

    expect(page.runs.map((run) => run.id)).toEqual([
      '66666666-6666-4666-8666-000000000001',
      '66666666-6666-4666-8666-000000000002',
    ]);
    expect(page.nextCursor).toBe('cursor-2');
    expect(page.filteredTotalCount).toBe(12);
  });

  test('maps detail jobs, steps, attempts, errors, and source locations', () => {
    const attempt = workflowStepAttemptDto({
      id: '66666666-6666-4666-8666-000000000001',
      attempt: 2,
      execution_order: 4,
      status: 'failed',
      exit_code: 1,
      output: {tail: 'stderr'},
      error: {exitCode: 1},
      gate_result: {kind: 'failed', passed: false, source: 'script', exit_code: 1},
      restart_reason: 'retry',
      restart_result: {kind: 'restart_enqueued', reason: 'retry'},
      started_at: '2026-05-07T01:01:10.000Z',
      finished_at: '2026-05-07T01:01:20.000Z',
    });
    const step = workflowStepDto({
      id: '55555555-5555-4555-8555-000000000001',
      name: null,
      display_name: 'Run tests',
      source_location: {start_line: 3, end_line: 5},
      status: 'failed',
      type: 'run',
      error: {
        message: 'Tests failed',
        exit_code: 1,
        signal: 'SIGTERM',
        reason: 'agent_invocation_failed',
        category: 'user',
      },
      position: 7,
      current_attempt: 2,
      attempts: [attempt],
    });
    const job = workflowJobDto({
      id: '44444444-4444-4444-8444-000000000001',
      name: 'test',
      status: 'failed',
      status_reason: 'step_failed',
      dependencies: ['build'],
      position: 2,
      queued_at: '2026-05-07T01:00:00.000Z',
      started_at: '2026-05-07T01:00:05.000Z',
      finished_at: '2026-05-07T01:02:00.000Z',
      steps: [step],
    });
    const dto = workflowRunDetailDto({latest_attempt: 4, jobs: [job]});

    const detail = toWorkflowRunDetail(dto);

    expect(detail.latestAttempt).toBe(4);
    expect(detail.jobs[0]).toMatchObject({
      id: '44444444-4444-4444-8444-000000000001',
      runAttemptId: '11111111-1111-4111-8111-111111111111',
      name: 'test',
      status: 'failed',
      statusReason: 'step_failed',
      dependencies: ['build'],
      queuedAt: '2026-05-07T01:00:00.000Z',
      startedAt: '2026-05-07T01:00:05.000Z',
      finishedAt: '2026-05-07T01:02:00.000Z',
    });
    expect(detail.jobs[0]?.steps[0]).toMatchObject({
      id: '55555555-5555-4555-8555-000000000001',
      jobId: '44444444-4444-4444-8444-000000000001',
      displayName: 'Run tests',
      sourceLocation: {startLine: 3, endLine: 5},
      currentAttempt: 2,
      error: {
        message: 'Tests failed',
        exitCode: 1,
        signal: 'SIGTERM',
        reason: 'agent_invocation_failed',
        category: 'user',
      },
    });
    expect(detail.jobs[0]?.steps[0]?.attempts[0]).toMatchObject({
      id: '66666666-6666-4666-8666-000000000001',
      executionOrder: 4,
      exitCode: 1,
      output: {tail: 'stderr'},
      error: {exitCode: 1},
      gateResult: {kind: 'failed', passed: false, source: 'script', exit_code: 1},
      restartReason: 'retry',
      restartResult: {kind: 'restart_enqueued', reason: 'retry'},
      startedAt: '2026-05-07T01:01:10.000Z',
      finishedAt: '2026-05-07T01:01:20.000Z',
    });
  });

  test('preserves null source, error, timing, and attempt fields', () => {
    const attempt = workflowStepAttemptDto({
      exit_code: null,
      output: null,
      error: null,
      gate_result: null,
      restart_reason: null,
      restart_result: null,
      finished_at: null,
    });
    const step = workflowStepDto({
      source_location: null,
      error: null,
      attempts: [attempt],
    });
    const job = workflowJobDto({
      queued_at: null,
      started_at: null,
      finished_at: null,
      steps: [step],
    });
    const dto = workflowRunDetailDto({
      inputs: null,
      source_snapshot: null,
      started_at: null,
      finished_at: null,
      jobs: [job],
    });

    const detail = toWorkflowRunDetail(dto);

    expect(detail).toMatchObject({
      inputs: null,
      sourceSnapshot: null,
      startedAt: null,
      finishedAt: null,
    });
    expect(detail.jobs[0]).toMatchObject({
      queuedAt: null,
      startedAt: null,
      finishedAt: null,
    });
    expect(detail.jobs[0]?.steps[0]).toMatchObject({
      sourceLocation: null,
      error: null,
    });
    expect(detail.jobs[0]?.steps[0]?.attempts[0]).toMatchObject({
      exitCode: null,
      output: null,
      error: null,
      gateResult: null,
      restartReason: null,
      restartResult: null,
      finishedAt: null,
    });
  });

  test('maps resolved agent step configuration from the opaque step config', () => {
    const step = workflowStepDto({
      type: 'agent',
      config: {
        provider: 'anthropic',
        model: 'claude-opus-4-8',
        thinking: 'high',
        prompt: 'Fix the failing tests.',
      },
    });
    const missingConfigStep = workflowStepDto({
      type: 'agent',
      config: {provider: '', model: 42},
    });

    const detail = toWorkflowRunDetail(
      workflowRunDetailDto({
        jobs: [workflowJobDto({steps: [step, missingConfigStep]})],
      }),
    );

    expect(detail.jobs[0]?.steps[0]?.agentConfig).toEqual({
      provider: 'anthropic',
      model: 'claude-opus-4-8',
      thinking: 'high',
    });
    expect(detail.jobs[0]?.steps[1]?.agentConfig).toEqual({
      provider: null,
      model: null,
      thinking: null,
    });
  });

  test('leaves non-agent steps without agent configuration', () => {
    const step = workflowStepDto({
      type: 'run',
      config: {provider: 'anthropic', model: 'claude-opus-4-8', thinking: 'high'},
    });

    const detail = toWorkflowRunDetail(
      workflowRunDetailDto({
        jobs: [workflowJobDto({steps: [step]})],
      }),
    );

    expect(detail.jobs[0]?.steps[0]?.agentConfig).toBeNull();
  });

  test('maps run attempt summaries', () => {
    const dto = workflowRunAttemptDto({
      id: '77777777-7777-4777-8777-777777777777',
      run_id: '11111111-1111-4111-8111-111111111111',
      attempt: 2,
      status: 'failed',
      created_at: '2026-05-07T01:02:00.000Z',
      started_at: '2026-05-07T01:02:10.000Z',
      finished_at: '2026-05-07T01:03:00.000Z',
      rerun_mode: 'all',
    });

    const attempt = toWorkflowRunAttempt(dto);

    expect(attempt).toEqual({
      id: '77777777-7777-4777-8777-777777777777',
      runId: '11111111-1111-4111-8111-111111111111',
      attempt: 2,
      status: 'failed',
      createdAt: '2026-05-07T01:02:00.000Z',
      startedAt: '2026-05-07T01:02:10.000Z',
      finishedAt: '2026-05-07T01:03:00.000Z',
      rerunMode: 'all',
    });
  });
});

describe('workflow run helpers', () => {
  test('formats trigger labels without dangling separators', () => {
    const withBoth = workflowRunTriggerLabel({triggerSource: 'github', triggerEvent: 'push'});
    const sourceOnly = workflowRunTriggerLabel({triggerSource: 'manual', triggerEvent: ''});
    const neither = workflowRunTriggerLabel({triggerSource: '', triggerEvent: ''});

    expect(withBoth).toBe('github · push');
    expect(sourceOnly).toBe('manual');
    expect(neither).toBe('');
  });

  test('formats visible trigger labels as the event name', () => {
    const withBoth = workflowRunTriggerDisplayLabel({
      triggerSource: 'github',
      triggerEvent: 'push',
    });
    const sourceOnly = workflowRunTriggerDisplayLabel({triggerSource: 'manual', triggerEvent: ''});
    const neither = workflowRunTriggerDisplayLabel({triggerSource: '', triggerEvent: ''});

    expect(withBoth).toBe('push');
    expect(sourceOnly).toBe('manual');
    expect(neither).toBe('');
  });

  test('formats short ids and classifies workflow statuses', () => {
    const short = workflowRunShortId('abc123');
    const long = workflowRunShortId('66666666-6666-4666-8666-666666666666');

    expect(short).toBe('abc123');
    expect(long).toBe('66666666');
    expect(isWorkflowRunTerminal('succeeded')).toBe(true);
    expect(isWorkflowRunTerminal('running')).toBe(false);
    expect(isWorkflowStatus('pending')).toBe(true);
    expect(isWorkflowStatus('timed_out')).toBe(false);
  });
});
