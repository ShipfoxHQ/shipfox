import {definitionResolvedEventSchema} from './events.js';

describe('definitionResolvedEventSchema', () => {
  const baseEvent = {
    definitionId: 'definition-id',
    projectId: 'project-id',
    workspaceId: 'workspace-id',
    configPath: '.shipfox/workflows/test.yml',
    triggers: {},
  };

  test('accepts an authenticated actor for manual resolution', () => {
    const actorUserId = 'user-id';

    expect(definitionResolvedEventSchema.parse({...baseEvent, actorUserId})).toEqual({
      ...baseEvent,
      actorUserId,
    });
  });

  test('keeps actor provenance optional for automated resolution', () => {
    expect(definitionResolvedEventSchema.parse(baseEvent)).toEqual(baseEvent);
  });
});
