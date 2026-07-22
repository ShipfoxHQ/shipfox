import {toInvitationAcceptance} from './invitation-acceptance-mapper.js';

describe('toInvitationAcceptance', () => {
  test('maps the acceptance response into the invitation domain', () => {
    const result = toInvitationAcceptance({
      membership: {
        id: '11111111-1111-4111-8111-111111111111',
        user_id: '22222222-2222-4222-8222-222222222222',
        workspace_id: '33333333-3333-4333-8333-333333333333',
      },
      already_member: true,
    });

    expect(result).toEqual({
      membership: {
        id: '11111111-1111-4111-8111-111111111111',
        userId: '22222222-2222-4222-8222-222222222222',
        workspaceId: '33333333-3333-4333-8333-333333333333',
      },
      alreadyMember: true,
    });
  });
});
