import {workspacesInterModuleContract} from './inter-module.js';

describe('workspacesInterModuleContract', () => {
  test('accepts workspace creator attribution with missing creator data', () => {
    const result = workspacesInterModuleContract.methods.getWorkspaceCreator.output.parse({
      creatorUserId: null,
    });

    expect(result).toEqual({creatorUserId: null});
  });

  test('defines the workspace-not-found failure', () => {
    const details = {workspaceId: '00000000-0000-4000-8000-000000000001'};
    const schema =
      workspacesInterModuleContract.methods.getWorkspaceCreator.errors['workspace-not-found'];

    expect(schema.parse(details)).toEqual(details);
  });
});
