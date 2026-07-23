import {modelProviderRouteParams} from './inputs.js';

describe('model provider route inputs', () => {
  it('requires a non-empty workspace id', () => {
    expect(modelProviderRouteParams({wid: 'workspace-1'})).toEqual({wid: 'workspace-1'});
    expect(() => modelProviderRouteParams({wid: ''})).toThrow(
      'Model provider route is missing the workspace path parameter.',
    );
    expect(() => modelProviderRouteParams({wid: 42})).toThrow();
  });
});
