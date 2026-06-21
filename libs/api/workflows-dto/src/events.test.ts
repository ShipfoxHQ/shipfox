import {workflowsJobTerminatedSchema, workflowsWorkflowRunTerminatedSchema} from './events.js';

const validJobTerminated = {
  jobId: 'job-1',
  runId: 'run-1',
  status: 'succeeded',
};

const validRunTerminated = {
  runId: 'run-1',
  projectId: 'proj-1',
  status: 'failed',
};

describe('workflowsJobTerminatedSchema', () => {
  it('parses a valid job-terminated payload unchanged', () => {
    const result = workflowsJobTerminatedSchema.parse(validJobTerminated);

    expect(result).toEqual(validJobTerminated);
  });

  it('rejects a payload missing a required field', () => {
    const {runId: _runId, ...withoutRunId} = validJobTerminated;

    const parse = () => workflowsJobTerminatedSchema.parse(withoutRunId);

    expect(parse).toThrow();
  });

  it('rejects a status outside the terminal set', () => {
    const input = {...validJobTerminated, status: 'running'};

    const parse = () => workflowsJobTerminatedSchema.parse(input);

    expect(parse).toThrow();
  });

  it('strips unknown keys (tolerant of forward-compatible producer additions)', () => {
    const input = {...validJobTerminated, addedLater: 'ignored'};

    const result = workflowsJobTerminatedSchema.parse(input);

    expect(result).toEqual(validJobTerminated);
  });
});

describe('workflowsWorkflowRunTerminatedSchema', () => {
  it('parses a valid run-terminated payload unchanged', () => {
    const result = workflowsWorkflowRunTerminatedSchema.parse(validRunTerminated);

    expect(result).toEqual(validRunTerminated);
  });

  it('rejects a payload missing a required field', () => {
    const {projectId: _projectId, ...withoutProjectId} = validRunTerminated;

    const parse = () => workflowsWorkflowRunTerminatedSchema.parse(withoutProjectId);

    expect(parse).toThrow();
  });
});
