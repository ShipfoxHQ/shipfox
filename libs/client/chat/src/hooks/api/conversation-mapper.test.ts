import {toConversationDetail, toConversationItem, toPageContextDto} from './conversation-mapper.js';

const RUN_ID = '44444444-4444-4444-8444-444444444444';
const JOB_ID = '55555555-5555-4555-8555-555555555555';

describe('toPageContextDto', () => {
  test('sends ids and status, and keeps display labels in the browser', () => {
    expect(
      toPageContextDto({
        page: 'job',
        runId: RUN_ID,
        runNumber: 214,
        attempt: 2,
        jobId: JOB_ID,
        status: 'failed',
      }),
    ).toEqual({page: 'job', run_id: RUN_ID, job_id: JOB_ID, attempt: 2, status: 'failed'});
    expect(
      toPageContextDto({page: 'workflow', definitionId: RUN_ID, name: 'ticket-to-pr'}),
    ).toEqual({
      page: 'workflow',
      definition_id: RUN_ID,
    });
  });

  test('drops a status the schema refuses, and sends no context for an invalid id', () => {
    expect(toPageContextDto({page: 'run', runId: RUN_ID, status: 'Timed Out'})).toEqual({
      page: 'run',
      run_id: RUN_ID,
    });
    expect(toPageContextDto({page: 'run', runId: 'not-a-uuid'})).toBeUndefined();
  });
});

describe('toConversationItem', () => {
  test('maps a run result, and reads a result stored before it named its run', () => {
    const item = toConversationItem({
      id: JOB_ID,
      seq: 3,
      entry_type: 'custom_message',
      turn_id: null,
      author_user_id: null,
      client_message_id: null,
      created_at: '2026-11-02T10:00:00.000Z',
      content: {
        type: 'run_result',
        run_result: {
          workflow_run_id: RUN_ID,
          run_attempt_id: JOB_ID,
          status: 'settled',
          job_keys: ['build'],
          outputs: null,
        },
      },
    });

    expect(item.content).toEqual({
      type: 'run_result',
      result: {
        runId: RUN_ID,
        attemptId: JOB_ID,
        status: 'settled',
        number: undefined,
        name: undefined,
        attempt: undefined,
      },
    });
  });
});

describe('toConversationDetail', () => {
  test('maps the active runs', () => {
    const detail = toConversationDetail({
      id: JOB_ID,
      project_id: RUN_ID,
      agent_key: 'shippy',
      title: 'Implement it',
      unread: false,
      last_seq: 4,
      last_agent_seq: 4,
      last_read_seq: 4,
      last_activity_at: '2026-11-02T10:00:00.000Z',
      created_at: '2026-11-02T10:00:00.000Z',
      active_turn: null,
      latest_turn: null,
      active_runs: [
        {
          workflow_run_id: RUN_ID,
          run_number: 214,
          name: 'implement',
          attempt: 2,
          status: 'running',
          started_at: null,
          jobs_finished: 1,
          jobs_total: 3,
        },
      ],
    });

    expect(detail.activeRuns).toEqual([
      {
        runId: RUN_ID,
        number: 214,
        name: 'implement',
        attempt: 2,
        status: 'running',
        startedAt: undefined,
        jobsFinished: 1,
        jobsTotal: 3,
      },
    ]);
  });
});
