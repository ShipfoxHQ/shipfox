import {projectRouteParams} from './inputs.js';

describe('project route inputs', () => {
  it('requires both workspace and project ids', () => {
    expect(projectRouteParams({wid: 'workspace-1', pid: 'project-1'})).toEqual({
      wid: 'workspace-1',
      pid: 'project-1',
    });
    expect(() => projectRouteParams({wid: 'workspace-1'})).toThrow(
      'Project route is missing required path parameters.',
    );
    expect(() => projectRouteParams({wid: ['workspace-1'], pid: 'project-1'})).toThrow();
  });
});
