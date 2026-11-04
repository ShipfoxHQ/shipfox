import {projectCreatedEventSchema, projectDeletedEventSchema} from './events.js';

const legacyProjectCreatedEvent = {
  actorId: 'actor-1',
  workspaceId: 'workspace-1',
  projectId: 'project-1',
  sourceConnectionId: 'connection-1',
  sourceExternalRepositoryId: 'repository-1',
};

describe('project created event schema', () => {
  test('accepts legacy in-flight payloads without a slug', () => {
    expect(projectCreatedEventSchema.parse(legacyProjectCreatedEvent)).toEqual(
      legacyProjectCreatedEvent,
    );
  });

  test('preserves slugs on new payloads', () => {
    expect(
      projectCreatedEventSchema.parse({...legacyProjectCreatedEvent, slug: 'project'}),
    ).toMatchObject({slug: 'project'});
  });
});

describe('project deleted event schema', () => {
  const deleted = {
    workspaceId: 'workspace-1',
    projectId: 'project-1',
    deletedBy: 'user-1',
    deletedAt: '2026-11-03T10:00:00.000Z',
  };

  test('accepts the payload a purge needs', () => {
    expect(projectDeletedEventSchema.parse(deleted)).toEqual(deleted);
  });

  test('rejects a payload with no deletion time', () => {
    const {deletedAt: _deletedAt, ...withoutTime} = deleted;

    expect(projectDeletedEventSchema.safeParse(withoutTime).success).toBe(false);
  });
});
