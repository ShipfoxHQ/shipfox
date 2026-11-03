import {toPageContextDto} from './conversation-mapper.js';

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
