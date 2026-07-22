import {
  getInvitationExpiry,
  getMemberRemovalRestriction,
  memberCount,
  type WorkspaceMember,
} from './membership.js';

const member: WorkspaceMember = {
  id: 'membership-1',
  userId: 'user-1',
  workspaceId: 'workspace-1',
  email: 'member@example.com',
  name: 'Member',
  role: 'admin',
  joinedAt: '2026-07-22T12:00:00.000Z',
  updatedAt: '2026-07-22T12:00:00.000Z',
};

describe('getInvitationExpiry', () => {
  const now = Date.parse('2026-07-22T12:00:00.000Z');

  it.each([
    ['active', '2026-07-24T12:00:00.000Z'],
    ['expires-soon', '2026-07-23T11:59:59.999Z'],
    ['expired', '2026-07-22T12:00:00.000Z'],
  ] as const)('classifies a %s invitation', (expected, expiresAt) => {
    const result = getInvitationExpiry({expiresAt}, now);

    expect(result).toBe(expected);
  });
});

describe('getMemberRemovalRestriction', () => {
  it('forbids self-removal before evaluating the member count', () => {
    const result = getMemberRemovalRestriction({
      member,
      currentUserId: member.userId,
      members: [member],
    });

    expect(result).toBe('self');
  });

  it('forbids removing the final member', () => {
    const result = getMemberRemovalRestriction({
      member,
      currentUserId: 'another-user',
      members: [member],
    });

    expect(result).toBe('last-member');
  });

  it('allows removal when another member remains', () => {
    const result = getMemberRemovalRestriction({
      member,
      currentUserId: 'another-user',
      members: [member, {...member, id: 'membership-2', userId: 'user-2'}],
    });

    expect(result).toBeUndefined();
  });
});

test('counts workspace members', () => {
  const result = memberCount([member, {...member, id: 'membership-2'}]);

  expect(result).toBe(2);
});
