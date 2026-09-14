import {workspacesInterModuleContract} from './inter-module.js';

describe('workspacesInterModuleContract', () => {
  test('accepts a minimal workspace summary and a missing result', () => {
    const method = workspacesInterModuleContract.methods.getWorkspaceSummary;
    const workspaceId = '00000000-0000-4000-8000-000000000001';

    expect(
      method.output.parse({
        id: workspaceId,
        name: 'Workspace',
        slug: 'workspace',
        status: 'active',
      }),
    ).toEqual({id: workspaceId, name: 'Workspace'});
    expect(method.output.parse(undefined)).toBeUndefined();
  });

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

  test('defines a status-only operating-state result', () => {
    const method = workspacesInterModuleContract.methods.getWorkspaceOperatingState;

    expect(method.output.parse({status: 'active'})).toEqual({status: 'active'});
    expect(method.output.parse({status: 'suspended'})).toEqual({status: 'suspended'});
    expect(method.output.parse({status: 'deleted'})).toEqual({status: 'deleted'});
  });
});
