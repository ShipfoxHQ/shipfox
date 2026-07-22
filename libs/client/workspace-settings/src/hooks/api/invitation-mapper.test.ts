import {toInvitation} from './invitation-mapper.js';

describe('toInvitation', () => {
  test('maps the transport response to the package domain model', () => {
    const invitation = toInvitation({
      id: 'f87901d8-4a7e-43e7-84f5-a9c73456657f',
      workspace_id: 'ab03cfd0-1845-453b-867c-a661c8e62f13',
      email: 'member@example.com',
      expires_at: '2026-07-29T12:00:00.000Z',
      accepted_at: null,
      invited_by_user_id: 'b8d2ab85-9e38-4449-af50-8beaabf058e5',
      invited_by_display: 'Noé',
      created_at: '2026-07-22T12:00:00.000Z',
      updated_at: '2026-07-22T12:00:00.000Z',
    });

    expect(invitation).toEqual({
      id: 'f87901d8-4a7e-43e7-84f5-a9c73456657f',
      workspaceId: 'ab03cfd0-1845-453b-867c-a661c8e62f13',
      email: 'member@example.com',
      expiresAt: '2026-07-29T12:00:00.000Z',
      acceptedAt: null,
      invitedByUserId: 'b8d2ab85-9e38-4449-af50-8beaabf058e5',
      invitedByDisplay: 'Noé',
      createdAt: '2026-07-22T12:00:00.000Z',
      updatedAt: '2026-07-22T12:00:00.000Z',
    });
  });
});
