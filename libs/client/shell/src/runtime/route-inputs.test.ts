import {parseWorkspaceParams, parseWorkspaceProjectParams} from './route-inputs.js';

describe('route input parsers', () => {
  it('drops missing and malformed workspace parameters', () => {
    expect(parseWorkspaceParams({wid: 'workspace-1'})).toEqual({wid: 'workspace-1'});
    expect(parseWorkspaceParams({wid: ''})).toEqual({});
    expect(parseWorkspaceParams({wid: ['workspace-1']})).toEqual({});
  });

  it('keeps valid workspace and project parameters independently', () => {
    expect(parseWorkspaceProjectParams({wid: 'workspace-1', pid: 'project-1'})).toEqual({
      wid: 'workspace-1',
      pid: 'project-1',
    });
    expect(parseWorkspaceProjectParams({wid: 'workspace-1', pid: null})).toEqual({
      wid: 'workspace-1',
    });
  });
});
