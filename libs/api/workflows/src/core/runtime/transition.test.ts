import {createInitialRuntimeState} from './runtime-state.js';
import {transitionRuntimeState} from './transition.js';

describe('transitionRuntimeState', () => {
  test('starts root jobs when a run starts', () => {
    const state = createInitialRuntimeState({
      jobs: [
        {id: 'j1', name: 'build', dependencies: []},
        {id: 'j2', name: 'test', dependencies: ['build']},
      ],
    });

    const result = transitionRuntimeState(state, {type: 'run_started'});

    expect(result.commands).toEqual([{type: 'start_job', jobId: 'j1'}]);
    expect(result.state.run.status).toBe('running');
    expect(result.state.jobs.map((job) => [job.id, job.status])).toEqual([
      ['j1', 'running'],
      ['j2', 'pending'],
    ]);
  });

  test('starts parallel root jobs in definition order', () => {
    const state = createInitialRuntimeState({
      jobs: [
        {id: 'j1', name: 'lint', dependencies: []},
        {id: 'j2', name: 'build', dependencies: []},
        {id: 'j3', name: 'test', dependencies: ['build']},
      ],
    });

    const result = transitionRuntimeState(state, {type: 'run_started'});

    expect(result.commands).toEqual([
      {type: 'start_job', jobId: 'j1'},
      {type: 'start_job', jobId: 'j2'},
    ]);
    expect(result.state.jobs.map((job) => [job.id, job.status])).toEqual([
      ['j1', 'running'],
      ['j2', 'running'],
      ['j3', 'pending'],
    ]);
  });

  test('starts newly ready jobs after dependency success', () => {
    const started = transitionRuntimeState(
      createInitialRuntimeState({
        jobs: [
          {id: 'j1', name: 'build', dependencies: []},
          {id: 'j2', name: 'test', dependencies: ['build']},
        ],
      }),
      {type: 'run_started'},
    ).state;

    const result = transitionRuntimeState(started, {
      type: 'job_completed',
      jobId: 'j1',
      status: 'succeeded',
    });

    expect(result.commands).toEqual([{type: 'start_job', jobId: 'j2'}]);
    expect(result.state.jobs.map((job) => [job.id, job.status])).toEqual([
      ['j1', 'succeeded'],
      ['j2', 'running'],
    ]);
  });

  test('cancels jobs blocked by failed dependencies and fails the run', () => {
    const started = transitionRuntimeState(
      createInitialRuntimeState({
        jobs: [
          {id: 'j1', name: 'build', dependencies: []},
          {id: 'j2', name: 'test', dependencies: ['build']},
          {id: 'j3', name: 'deploy', dependencies: ['test']},
        ],
      }),
      {type: 'run_started'},
    ).state;

    const result = transitionRuntimeState(started, {
      type: 'job_completed',
      jobId: 'j1',
      status: 'failed',
    });

    expect(result.commands).toEqual([
      {type: 'cancel_job', jobId: 'j2'},
      {type: 'cancel_job', jobId: 'j3'},
      {type: 'complete_run', status: 'failed'},
    ]);
    expect(result.state.run.status).toBe('failed');
  });

  test('cancels a diamond join after one dependency fails', () => {
    const started = transitionRuntimeState(
      createInitialRuntimeState({
        jobs: [
          {id: 'j1', name: 'build', dependencies: []},
          {id: 'j2', name: 'unit', dependencies: ['build']},
          {id: 'j3', name: 'integration', dependencies: ['build']},
          {id: 'j4', name: 'deploy', dependencies: ['unit', 'integration']},
        ],
      }),
      {type: 'run_started'},
    ).state;
    const afterBuild = transitionRuntimeState(started, {
      type: 'job_completed',
      jobId: 'j1',
      status: 'succeeded',
    }).state;
    const afterIntegration = transitionRuntimeState(afterBuild, {
      type: 'job_completed',
      jobId: 'j3',
      status: 'succeeded',
    }).state;

    const result = transitionRuntimeState(afterIntegration, {
      type: 'job_completed',
      jobId: 'j2',
      status: 'failed',
    });

    expect(result.commands).toEqual([
      {type: 'cancel_job', jobId: 'j4'},
      {type: 'complete_run', status: 'failed'},
    ]);
    expect(result.state.jobs.map((job) => [job.id, job.status])).toEqual([
      ['j1', 'succeeded'],
      ['j2', 'failed'],
      ['j3', 'succeeded'],
      ['j4', 'cancelled'],
    ]);
    expect(result.state.run.status).toBe('failed');
  });

  test('completes an empty run as succeeded', () => {
    const state = createInitialRuntimeState({jobs: []});

    const result = transitionRuntimeState(state, {type: 'run_started'});

    expect(result.commands).toEqual([{type: 'complete_run', status: 'succeeded'}]);
    expect(result.state.run.status).toBe('succeeded');
  });

  test('ignores completion events for unknown jobs', () => {
    const started = transitionRuntimeState(
      createInitialRuntimeState({
        jobs: [{id: 'j1', name: 'build', dependencies: []}],
      }),
      {type: 'run_started'},
    ).state;

    const result = transitionRuntimeState(started, {
      type: 'job_completed',
      jobId: 'missing',
      status: 'succeeded',
    });

    expect(result.commands).toEqual([]);
    expect(result.state).toEqual(started);
  });

  test('ignores completion events for jobs that are not running', () => {
    const state = createInitialRuntimeState({
      jobs: [{id: 'j1', name: 'build', dependencies: []}],
    });

    const result = transitionRuntimeState(state, {
      type: 'job_completed',
      jobId: 'j1',
      status: 'succeeded',
    });

    expect(result.commands).toEqual([]);
    expect(result.state).toEqual(state);
  });

  test('ignores events after the run reaches a terminal status', () => {
    const terminal = transitionRuntimeState(createInitialRuntimeState({jobs: []}), {
      type: 'run_started',
    }).state;

    const result = transitionRuntimeState(terminal, {type: 'run_started'});

    expect(result.commands).toEqual([]);
    expect(result.state).toEqual(terminal);
  });

  test('keeps a malformed cyclic state pending because runtime input must be validated', () => {
    const state = createInitialRuntimeState({
      jobs: [
        {id: 'j1', name: 'build', dependencies: ['test']},
        {id: 'j2', name: 'test', dependencies: ['build']},
      ],
    });

    const result = transitionRuntimeState(state, {type: 'run_started'});

    expect(result.commands).toEqual([]);
    expect(result.state.run.status).toBe('running');
    expect(result.state.jobs.map((job) => [job.id, job.status])).toEqual([
      ['j1', 'pending'],
      ['j2', 'pending'],
    ]);
  });
});
