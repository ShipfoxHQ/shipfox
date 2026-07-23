import {validateWorkflowRunsSearch, workflowRouteParams} from './inputs.js';

describe('workflow route inputs', () => {
  it('normalizes malformed search values to safe defaults', () => {
    expect(validateWorkflowRunsSearch({search: ['unexpected'], status: 'unknown'})).toEqual({});
    expect(validateWorkflowRunsSearch({status: 'failed', runAttempt: '2'})).toEqual({
      status: 'failed',
      runAttempt: 2,
    });
  });

  it('requires workspace and project path parameters', () => {
    expect(workflowRouteParams({wid: 'workspace-1', pid: 'project-1'})).toEqual({
      wid: 'workspace-1',
      pid: 'project-1',
    });
    expect(() => workflowRouteParams({wid: 'workspace-1'})).toThrow(
      'Workflow route is missing required path parameters.',
    );
    expect(() => workflowRouteParams({wid: 'workspace-1', pid: null})).toThrow();
  });
});
