import {toWorkspaceMember} from './membership-mapper.js';

test('maps the member transport response to the package domain model', () => {
  const member = toWorkspaceMember({
    id: 'f87901d8-4a7e-43e7-84f5-a9c73456657f',
    workspace_id: 'ab03cfd0-1845-453b-867c-a661c8e62f13',
    user_id: 'b8d2ab85-9e38-4449-af50-8beaabf058e5',
    user_email: 'member@example.com',
    user_name: 'Noé',
    created_at: '2026-07-22T12:00:00.000Z',
    updated_at: '2026-07-22T12:00:00.000Z',
  });

  expect(member).toEqual({
    id: 'f87901d8-4a7e-43e7-84f5-a9c73456657f',
    workspaceId: 'ab03cfd0-1845-453b-867c-a661c8e62f13',
    userId: 'b8d2ab85-9e38-4449-af50-8beaabf058e5',
    email: 'member@example.com',
    name: 'Noé',
    role: 'admin',
    joinedAt: '2026-07-22T12:00:00.000Z',
    updatedAt: '2026-07-22T12:00:00.000Z',
  });
});
