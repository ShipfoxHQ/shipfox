import {workspaceCreatedEventSchema, workspacesMemberRemovedSchema} from './events.js';

describe('workspaceCreatedEventSchema', () => {
  test('accepts legacy events without a slug', () => {
    expect(
      workspaceCreatedEventSchema.parse({
        workspaceId: 'workspace-id',
        name: 'Workspace',
        creatorUserId: 'user-id',
      }),
    ).toEqual({
      workspaceId: 'workspace-id',
      name: 'Workspace',
      creatorUserId: 'user-id',
    });
  });
});

describe('workspacesMemberRemovedSchema', () => {
  const baseEvent = {
    workspaceId: '00000000-0000-4000-8000-000000000001',
    userId: '00000000-0000-4000-8000-000000000002',
  };

  test('accepts a removal without an actor for self-leave events', () => {
    expect(workspacesMemberRemovedSchema.parse(baseEvent)).toEqual(baseEvent);
  });

  test('accepts an administrator actor', () => {
    const actorUserId = '00000000-0000-4000-8000-000000000003';

    expect(workspacesMemberRemovedSchema.parse({...baseEvent, actorUserId})).toEqual({
      ...baseEvent,
      actorUserId,
    });
  });
});
